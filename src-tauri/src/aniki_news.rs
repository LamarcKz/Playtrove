//! As duas fontes RSS/Atom do leitor Aniki, com cache próprio e sem integração de contas.

use std::collections::HashMap;
use std::io::{Cursor, Read, Write};
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex, PoisonError};
use std::time::Duration;

use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use chrono::{DateTime, Utc};
use quick_xml::{Reader, events::Event};
use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State, Url};
use ureq::unversioned::resolver::{DefaultResolver, ResolvedSocketAddrs, Resolver};
use ureq::unversioned::transport::{DefaultConnector, NextTimeout};

const DEFAULT_A: &str = "https://gameinformer.com/news.xml";
const DEFAULT_B: &str = "https://gameinformer.com/reviews.xml";
const MAX_FEED: usize = 2 * 1024 * 1024;
const MAX_IMAGE: usize = 5 * 1024 * 1024;
const MAX_CACHE: u64 = 16 * 1024 * 1024;
const TTL_SECONDS: i64 = 3 * 60 * 60;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub enum NewsSource {
    A,
    B,
}
impl NewsSource {
    fn index(self) -> usize {
        if self == Self::A { 0 } else { 1 }
    }
    fn default_url(self) -> &'static str {
        if self == Self::A { DEFAULT_A } else { DEFAULT_B }
    }
    fn filename(self) -> &'static str {
        if self == Self::A { "source-a.json" } else { "source-b.json" }
    }
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NewsError {
    Fetch,
    InvalidFeed,
    Empty,
    Storage,
    Config,
    Cancelled,
    Busy,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct NewsFeed {
    pub title: String,
    pub url: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewsConfig {
    pub enabled: bool,
    pub source_a: NewsFeed,
    pub source_b: NewsFeed,
}
impl Default for NewsConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            source_a: NewsFeed { title: "News".into(), url: DEFAULT_A.into() },
            source_b: NewsFeed { title: "Reviews".into(), url: DEFAULT_B.into() },
        }
    }
}
impl NewsConfig {
    fn feed(&self, source: NewsSource) -> &NewsFeed {
        if source == NewsSource::A { &self.source_a } else { &self.source_b }
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsArticle {
    pub id: String,
    pub title: String,
    pub published_at: String,
    pub url: Option<String>,
    pub summary: String,
    pub content_text: String,
    pub image_data_url: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsSnapshot {
    pub source: NewsSource,
    pub title: String,
    pub configured_url: String,
    pub resolved_url: String,
    pub items: Vec<NewsArticle>,
    pub last_refresh_at: Option<String>,
    pub from_cache: bool,
    pub stale: bool,
    pub error: Option<NewsError>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NewsCache {
    configured_url: String,
    resolved_url: String,
    last_refresh_at: String,
    items: Vec<NewsArticle>,
}
struct ParsedArticle {
    article: NewsArticle,
    image_url: Option<String>,
}

fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !ip.is_private()
                && !ip.is_loopback()
                && !ip.is_link_local()
                && !ip.is_unspecified()
                && !ip.is_broadcast()
                && a != 0
                && a < 224
                && !(a == 100 && (64..=127).contains(&b))
                && !(a == 192 && b == 0 && c <= 2)
                && !(a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100)))
                && !(a == 203 && b == 0 && c == 113)
        }
        IpAddr::V6(ip) => ip.to_ipv4_mapped().map(|ip| public_ip(IpAddr::V4(ip))).unwrap_or_else(|| {
            let s = ip.segments();
            (s[0] & 0xe000) == 0x2000 && !(s[0] == 0x2001 && s[1] == 0x0db8)
        }),
    }
}
fn web_url(value: &str, base: Option<&str>, allow_local: bool) -> Option<String> {
    if value.len() > 4096 || value.chars().any(char::is_control) {
        return None;
    }
    let url = Url::parse(value.trim()).ok().or_else(|| Url::parse(base?).ok()?.join(value.trim()).ok())?;
    if !matches!(url.scheme(), "http" | "https") || !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    let host = url.host_str()?.trim_matches(['[', ']']).trim_end_matches('.').to_lowercase();
    let local = host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || !host.contains('.') && host.parse::<IpAddr>().is_err();
    if !allow_local && (local || host.parse::<IpAddr>().is_ok_and(|ip| !public_ip(ip))) {
        return None;
    }
    Some(url.into())
}
fn hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

#[derive(Default)]
struct XmlNode {
    name: String,
    attrs: HashMap<String, String>,
    parts: Vec<XmlPart>,
    base: String,
}
enum XmlPart {
    Text(String),
    Child(XmlNode),
}
impl XmlNode {
    fn children(&self) -> impl Iterator<Item = &XmlNode> {
        self.parts.iter().filter_map(|part| match part {
            XmlPart::Child(node) => Some(node),
            _ => None,
        })
    }
    fn child(&self, name: &str) -> Option<&XmlNode> {
        self.children().find(|node| node.name == name)
    }
    fn text(&self) -> String {
        self.parts
            .iter()
            .map(|part| match part {
                XmlPart::Text(text) => text.clone(),
                XmlPart::Child(child) => child.text(),
            })
            .collect()
    }
    fn html(&self) -> String {
        self.parts
            .iter()
            .map(|part| match part {
                XmlPart::Text(text) => text.clone(),
                XmlPart::Child(child) => {
                    let src = child
                        .attrs
                        .get("src")
                        .map(|src| format!(" src=\"{}\"", quick_xml::escape::escape(src)))
                        .unwrap_or_default();
                    format!("<{}{src}>{}</{}>", child.name, child.html(), child.name)
                }
            })
            .collect()
    }
}
fn xml_tree(bytes: &[u8], base: &str) -> Result<XmlNode, NewsError> {
    if bytes.len() > MAX_FEED {
        return Err(NewsError::InvalidFeed);
    }
    let xml = std::str::from_utf8(bytes).map_err(|_| NewsError::InvalidFeed)?.trim_start_matches('\u{feff}');
    let mut reader = Reader::from_str(xml);
    let mut stack = vec![XmlNode { base: base.into(), ..Default::default() }];
    let mut nodes = 0;
    loop {
        match reader.read_event().map_err(|_| NewsError::InvalidFeed)? {
            Event::Start(element) | Event::Empty(element) => {
                nodes += 1;
                if nodes > 50_000 || stack.len() > 64 {
                    return Err(NewsError::InvalidFeed);
                }
                let mut attrs = HashMap::new();
                for attr in element.attributes() {
                    let attr = attr.map_err(|_| NewsError::InvalidFeed)?;
                    attrs.insert(
                        attr.key.as_ref().to_string(),
                        attr.normalized_value(quick_xml::XmlVersion::Implicit1_0)
                            .map_err(|_| NewsError::InvalidFeed)?
                            .into_owned(),
                    );
                }
                let inherited = &stack.last().unwrap().base;
                let effective = attrs
                    .get("xml:base")
                    .and_then(|value| Url::parse(inherited).ok()?.join(value).ok())
                    .map(String::from)
                    .unwrap_or_else(|| inherited.clone());
                let node = XmlNode { name: element.local_name().as_ref().to_string(), attrs, parts: vec![], base: effective };
                // Empty events end in '/>'; Reader position includes the complete token.
                if xml.as_bytes().get(reader.buffer_position().saturating_sub(2) as usize) == Some(&b'/') {
                    stack.last_mut().unwrap().parts.push(XmlPart::Child(node));
                } else {
                    stack.push(node)
                }
            }
            Event::End(_) => {
                if stack.len() <= 1 {
                    return Err(NewsError::InvalidFeed);
                }
                let node = stack.pop().unwrap();
                stack.last_mut().unwrap().parts.push(XmlPart::Child(node));
            }
            Event::Text(text) => stack.last_mut().unwrap().parts.push(XmlPart::Text(text.xml10_content().into_owned())),
            Event::CData(text) => stack.last_mut().unwrap().parts.push(XmlPart::Text(text.xml10_content().into_owned())),
            Event::GeneralRef(reference) => {
                let value = reference
                    .resolve_char_ref()
                    .map_err(|_| NewsError::InvalidFeed)?
                    .map(|c| c.to_string())
                    .or_else(|| match reference.as_ref() {
                        "amp" => Some("&".into()),
                        "lt" => Some("<".into()),
                        "gt" => Some(">".into()),
                        "apos" => Some("'".into()),
                        "quot" => Some("\"".into()),
                        _ => None,
                    })
                    .ok_or(NewsError::InvalidFeed)?;
                stack.last_mut().unwrap().parts.push(XmlPart::Text(value));
            }
            Event::DocType(_) => return Err(NewsError::InvalidFeed),
            Event::Eof => break,
            _ => {}
        }
    }
    if stack.len() != 1 {
        return Err(NewsError::InvalidFeed);
    }
    let root = stack.pop().unwrap();
    let mut children = root.parts.into_iter().filter_map(|part| match part {
        XmlPart::Child(node) => Some(node),
        _ => None,
    });
    let root = children.next().ok_or(NewsError::InvalidFeed)?;
    if children.next().is_some() {
        return Err(NewsError::InvalidFeed);
    }
    Ok(root)
}
static ENTITIES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);").unwrap());
fn decode_html(value: &str) -> String {
    ENTITIES
        .replace_all(value, |captures: &regex::Captures<'_>| {
            let entity = &captures[1];
            let number = entity
                .strip_prefix("#x")
                .and_then(|n| u32::from_str_radix(n, 16).ok())
                .or_else(|| entity.strip_prefix('#').and_then(|n| n.parse().ok()));
            number.and_then(char::from_u32).map(|c| c.to_string()).unwrap_or_else(|| {
                match entity {
                    "amp" => "&",
                    "lt" => "<",
                    "gt" => ">",
                    "quot" => "\"",
                    "apos" => "'",
                    "nbsp" => " ",
                    "ndash" => "–",
                    "mdash" => "—",
                    "hellip" => "…",
                    "copy" => "©",
                    "reg" => "®",
                    "trade" => "™",
                    _ => captures.get(0).unwrap().as_str(),
                }
                .to_string()
            })
        })
        .into_owned()
}
static ACTIVE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?is)<!--.*?-->|<(?:script|style|head|iframe|object|embed|svg|math|form|template)\b[^>]*>.*?(?:</(?:script|style|head|iframe|object|embed|svg|math|form|template)\s*>|$)").unwrap()
});
static BREAKS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)<(?:br\b[^>]*|/(?:p|div|h[1-6]|li|blockquote|section|tr)\s*)>").unwrap());
static TAGS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)<[^>]*>").unwrap());
static IMAGE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?is)<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))"#).unwrap());
fn reader_text(html: &str) -> String {
    let html = decode_html(html);
    let safe = ACTIVE.replace_all(&html, "");
    let paragraphs = BREAKS.replace_all(&safe, "\n\n");
    TAGS.replace_all(&paragraphs, "")
        .split('\n')
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
        .chars()
        .take(100_000)
        .collect()
}
fn parse_feed(bytes: &[u8], feed_url: &str, now: DateTime<Utc>) -> Result<Vec<ParsedArticle>, NewsError> {
    let allow_local = (cfg!(test) || crate::test_mode::test_mode().data_dir.is_some()) && loopback_url(feed_url);
    let root = xml_tree(bytes, feed_url)?;
    let (container, item_name) = match root.name.as_str() {
        "rss" => (root.child("channel").ok_or(NewsError::InvalidFeed)?, "item"),
        "feed" => (&root, "entry"),
        _ => return Err(NewsError::InvalidFeed),
    };
    let mut items = vec![];
    for node in container.children().filter(|node| node.name == item_name) {
        let title = node.child("title").map(|n| reader_text(&n.text())).unwrap_or_default();
        if title.is_empty() {
            continue;
        }
        let date = ["pubDate", "published", "updated", "date"]
            .iter()
            .find_map(|name| {
                node.child(name).and_then(|n| {
                    let text = n.text();
                    DateTime::parse_from_rfc3339(&text)
                        .or_else(|_| DateTime::parse_from_rfc2822(&text))
                        .ok()
                        .map(|dt| dt.with_timezone(&Utc))
                })
            })
            .unwrap_or(now - chrono::Duration::days(30));
        if date < now - chrono::Duration::days(30) {
            continue;
        }
        let link = node.children().find(|n| n.name == "link" && n.attrs.get("rel").is_none_or(|rel| rel == "alternate"));
        let url =
            link.and_then(|n| web_url(n.attrs.get("href").map(String::as_str).unwrap_or(&n.text()), Some(&n.base), allow_local));
        let content = node
            .child("encoded")
            .or_else(|| {
                node.children().find(|n| {
                    n.name == "content" && !n.attrs.contains_key("src") && !n.attrs.contains_key("url") && !n.parts.is_empty()
                })
            })
            .or_else(|| node.child("description"))
            .or_else(|| node.child("summary"));
        let html = content.map(XmlNode::html).unwrap_or_default();
        let content_text = reader_text(&html);
        let summary = node
            .child("description")
            .or_else(|| node.child("summary"))
            .map(|n| reader_text(&n.html()))
            .filter(|text| !text.is_empty())
            .unwrap_or_else(|| content_text.clone())
            .chars()
            .take(240)
            .collect();
        let image_base = url.as_deref().unwrap_or(&node.base);
        let image_url = node
            .children()
            .filter(|n| n.name == "enclosure" || n.name == "content" || n.name == "thumbnail")
            .find_map(|n| n.attrs.get("url").and_then(|value| web_url(value, Some(&n.base), allow_local)))
            .or_else(|| {
                IMAGE.captures(&ACTIVE.replace_all(&html, "")).and_then(|captures| {
                    (1..=3)
                        .find_map(|i| captures.get(i))
                        .and_then(|m| web_url(&decode_html(m.as_str()), Some(image_base), allow_local))
                })
            });
        let published_at = date.to_rfc3339();
        let id = hash(&format!("{title}|{published_at}"));
        items.push(ParsedArticle {
            article: NewsArticle {
                id,
                title: title.chars().take(500).collect(),
                published_at,
                url,
                summary,
                content_text,
                image_data_url: None,
            },
            image_url,
        });
        if items.len() == 30 {
            break;
        }
    }
    Ok(items)
}
fn raster_data_url(bytes: &[u8]) -> Option<String> {
    if bytes.len() > MAX_IMAGE {
        return None;
    }
    let mut reader = image::ImageReader::new(Cursor::new(bytes)).with_guessed_format().ok()?;
    if !matches!(reader.format()?, image::ImageFormat::Png | image::ImageFormat::Jpeg | image::ImageFormat::WebP) {
        return None;
    }
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(64 * 1024 * 1024);
    reader.limits(limits);
    let image = reader.decode().ok()?.thumbnail(640, 360).to_rgb8();
    let mut output = vec![];
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut output, 80).encode_image(&image).ok()?;
    if output.len() > 64 * 1024 {
        output.clear();
        let smaller = image::DynamicImage::ImageRgb8(image).thumbnail(320, 180).to_rgb8();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut output, 65).encode_image(&smaller).ok()?;
    }
    if output.len() > 64 * 1024 {
        return None;
    }
    Some(format!("data:image/jpeg;base64,{}", BASE64.encode(output)))
}

struct FetchedNews {
    bytes: Vec<u8>,
    url: String,
}
trait NewsFetch: Send + Sync {
    fn get(&self, url: &str, limit: usize, cancelled: &AtomicBool) -> Result<FetchedNews, NewsError>;
}
fn loopback_url(url: &str) -> bool {
    Url::parse(url)
        .ok()
        .and_then(|url| url.host_str().map(|host| host.trim_matches(['[', ']']).to_string()))
        .is_some_and(|host| host == "localhost" || host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback()))
}
#[derive(Debug)]
struct NewsResolver {
    local_only: bool,
}
impl Resolver for NewsResolver {
    fn resolve(
        &self,
        uri: &ureq::http::Uri,
        config: &ureq::config::Config,
        timeout: NextTimeout,
    ) -> Result<ResolvedSocketAddrs, ureq::Error> {
        let addresses = DefaultResolver::default().resolve(uri, config, timeout)?;
        if addresses.iter().any(|address| if self.local_only { !address.ip().is_loopback() } else { !public_ip(address.ip()) }) {
            return Err(ureq::Error::HostNotFound);
        }
        Ok(addresses)
    }
}
struct HttpNewsFetch {
    agent: ureq::Agent,
    local_only: bool,
}
impl HttpNewsFetch {
    fn new(local_only: bool) -> Self {
        let config = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .max_redirects(0)
            .max_redirects_will_error(false)
            .proxy(None)
            .timeout_global(Some(Duration::from_secs(15)))
            .timeout_per_read(Some(Duration::from_secs(2)))
            .user_agent("Playtrove RSS reader")
            .build();
        Self { agent: ureq::Agent::with_parts(config, DefaultConnector::default(), NewsResolver { local_only }), local_only }
    }
}
impl NewsFetch for HttpNewsFetch {
    fn get(&self, value: &str, limit: usize, cancelled: &AtomicBool) -> Result<FetchedNews, NewsError> {
        let mut url = web_url(value, None, self.local_only).ok_or(NewsError::Fetch)?;
        for _ in 0..=5 {
            if cancelled.load(Ordering::Relaxed) {
                return Err(NewsError::Cancelled);
            }
            // A pasta temporária dos testes nunca libera acesso aos feeds públicos, nem por redirect.
            if self.local_only && !loopback_url(&url) {
                return Err(NewsError::Fetch);
            }
            let mut response = self
                .agent
                .get(&url)
                .header("Accept", "application/rss+xml, application/atom+xml, application/xml, image/*;q=0.8, */*;q=0.5")
                .call()
                .map_err(|_| NewsError::Fetch)?;
            let status = response.status().as_u16();
            if matches!(status, 301 | 302 | 303 | 307 | 308) {
                url = response
                    .headers()
                    .get("location")
                    .and_then(|header| header.to_str().ok())
                    .and_then(|value| web_url(value, Some(&url), self.local_only))
                    .ok_or(NewsError::Fetch)?;
                continue;
            }
            if !(200..300).contains(&status) {
                return Err(NewsError::Fetch);
            }
            let mut bytes = vec![];
            let mut reader = response.body_mut().as_reader();
            let mut buffer = [0; 8192];
            loop {
                if cancelled.load(Ordering::Relaxed) {
                    return Err(NewsError::Cancelled);
                }
                let read = reader.read(&mut buffer).map_err(|_| NewsError::Fetch)?;
                if read == 0 {
                    break;
                }
                if bytes.len() + read > limit {
                    return Err(NewsError::Fetch);
                }
                bytes.extend_from_slice(&buffer[..read]);
            }
            return Ok(FetchedNews { bytes, url });
        }
        Err(NewsError::Fetch)
    }
}

#[derive(Clone)]
pub struct AnikiNewsService(Arc<NewsServiceInner>);
struct NewsServiceInner {
    root: PathBuf,
    fetch: Arc<dyn NewsFetch>,
    local_only: bool,
    storage: Mutex<()>,
    sources: [Mutex<()>; 2],
    requests: Mutex<HashMap<String, NewsRequest>>,
    revision: AtomicU64,
}
struct NewsRequest {
    cancelled: Arc<AtomicBool>,
    active: bool,
}
impl AnikiNewsService {
    /// Apenas construir/ler a configuração não consulta nenhum serviço externo.
    pub fn new(root: PathBuf) -> Self {
        let local_only = cfg!(test) || crate::test_mode::test_mode().data_dir.is_some();
        Self::with_fetch(root, Arc::new(HttpNewsFetch::new(local_only)), local_only)
    }
    fn with_fetch(root: PathBuf, fetch: Arc<dyn NewsFetch>, local_only: bool) -> Self {
        Self(Arc::new(NewsServiceInner {
            root,
            fetch,
            local_only,
            storage: Mutex::new(()),
            sources: [Mutex::new(()), Mutex::new(())],
            requests: Mutex::new(HashMap::new()),
            revision: AtomicU64::new(0),
        }))
    }
    fn config_unlocked(&self) -> Result<NewsConfig, NewsError> {
        let path = self.0.root.join("config.json");
        if !path.exists() {
            return Ok(NewsConfig::default());
        }
        let config = load_json::<NewsConfig>(&path)?.ok_or(NewsError::Storage)?;
        self.validate(config)
    }
    fn validate(&self, mut config: NewsConfig) -> Result<NewsConfig, NewsError> {
        for (feed, default) in [(&mut config.source_a, DEFAULT_A), (&mut config.source_b, DEFAULT_B)] {
            feed.title = feed.title.trim().to_string();
            if feed.title.is_empty() || feed.title.chars().count() > 80 || feed.title.chars().any(char::is_control) {
                return Err(NewsError::Config);
            }
            feed.url = web_url(if feed.url.trim().is_empty() { default } else { &feed.url }, None, self.0.local_only)
                .ok_or(NewsError::Config)?;
        }
        Ok(config)
    }
    pub fn get_config(&self) -> Result<NewsConfig, NewsError> {
        let _guard = self.0.storage.lock().unwrap_or_else(PoisonError::into_inner);
        self.config_unlocked()
    }
    pub fn set_config(&self, config: NewsConfig) -> Result<NewsConfig, NewsError> {
        let config = self.validate(config)?;
        let _guard = self.0.storage.lock().unwrap_or_else(PoisonError::into_inner);
        atomic_json(&self.0.root, "config.json", &config)?;
        self.0.revision.fetch_add(1, Ordering::SeqCst);
        for entry in self.0.requests.lock().unwrap_or_else(PoisonError::into_inner).values() {
            entry.cancelled.store(true, Ordering::SeqCst)
        }
        Ok(config)
    }
    fn load_cache(&self, source: NewsSource, config: &NewsConfig) -> Result<Option<NewsCache>, NewsError> {
        Ok(load_json::<NewsCache>(&self.0.root.join(source.filename()))?
            .filter(|cache| cache.configured_url == config.feed(source).url))
    }
    pub fn read(&self, source: NewsSource) -> Result<NewsSnapshot, NewsError> {
        self.read_at(source, Utc::now())
    }
    fn read_at(&self, source: NewsSource, now: DateTime<Utc>) -> Result<NewsSnapshot, NewsError> {
        let _guard = self.0.storage.lock().unwrap_or_else(PoisonError::into_inner);
        let config = self.config_unlocked()?;
        match self.load_cache(source, &config) {
            Ok(cache) => Ok(snapshot(source, &config, cache.as_ref(), now, true, None)),
            Err(error) => Ok(snapshot(source, &config, None, now, true, Some(error))),
        }
    }
    pub fn cancel(&self, request_id: &str) {
        if !valid_request_id(request_id) {
            return;
        }
        let mut requests = self.0.requests.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(entry) = requests.get(request_id) {
            entry.cancelled.store(true, Ordering::SeqCst)
        } else if requests.len() < 128 {
            requests.insert(request_id.into(), NewsRequest { cancelled: Arc::new(AtomicBool::new(true)), active: false });
        }
    }
    pub fn refresh(&self, source: NewsSource, request_id: &str, force: bool) -> Result<NewsSnapshot, NewsError> {
        self.refresh_at(source, request_id, force, Utc::now())
    }
    fn refresh_at(
        &self,
        source: NewsSource,
        request_id: &str,
        force: bool,
        now: DateTime<Utc>,
    ) -> Result<NewsSnapshot, NewsError> {
        if !valid_request_id(request_id) {
            return Err(NewsError::Config);
        }
        let flag = {
            let mut requests = self.0.requests.lock().unwrap_or_else(PoisonError::into_inner);
            if let Some(entry) = requests.get(request_id) {
                if entry.cancelled.load(Ordering::SeqCst) {
                    if !entry.active {
                        requests.remove(request_id);
                    }
                    return Err(NewsError::Cancelled);
                }
                return Err(NewsError::Busy);
            }
            if requests.len() >= 128 {
                requests.retain(|_, entry| entry.active);
            }
            if requests.len() >= 128 {
                return Err(NewsError::Busy);
            }
            let flag = Arc::new(AtomicBool::new(false));
            requests.insert(request_id.into(), NewsRequest { cancelled: flag.clone(), active: true });
            flag
        };
        let result = self.refresh_inner(source, force, now, &flag);
        self.0.requests.lock().unwrap_or_else(PoisonError::into_inner).remove(request_id);
        result
    }
    fn refresh_inner(
        &self,
        source: NewsSource,
        force: bool,
        now: DateTime<Utc>,
        cancelled: &AtomicBool,
    ) -> Result<NewsSnapshot, NewsError> {
        let _source_guard = self.0.sources[source.index()].lock().unwrap_or_else(PoisonError::into_inner);
        let (config, cache, revision) = {
            let _guard = self.0.storage.lock().unwrap_or_else(PoisonError::into_inner);
            let config = self.config_unlocked()?;
            let cache = self.load_cache(source, &config).unwrap_or(None);
            (config, cache, self.0.revision.load(Ordering::SeqCst))
        };
        if cancelled.load(Ordering::SeqCst) {
            return Err(NewsError::Cancelled);
        }
        if !config.enabled || !force && cache.as_ref().is_some_and(|cache| fresh_cache(cache, now)) {
            return Ok(snapshot(source, &config, cache.as_ref(), now, true, None));
        }
        let feed_url = &config.feed(source).url;
        let load = |url: &str| {
            let response = self.0.fetch.get(url, MAX_FEED, cancelled)?;
            let articles = parse_feed(&response.bytes, &response.url, now)?;
            if articles.is_empty() {
                return Err(NewsError::Empty);
            }
            Ok((response.url, articles))
        };
        let mut fetched = load(feed_url);
        if fetched.is_err() && !cancelled.load(Ordering::SeqCst) && feed_url != source.default_url() {
            fetched = load(source.default_url())
        }
        if cancelled.load(Ordering::SeqCst) {
            return Err(NewsError::Cancelled);
        }
        let (resolved_url, mut fresh) = match fetched {
            Ok(value) => value,
            Err(error) => return Ok(snapshot(source, &config, cache.as_ref(), now, true, Some(error))),
        };
        for item in &mut fresh {
            if cancelled.load(Ordering::SeqCst) {
                return Err(NewsError::Cancelled);
            }
            item.article.image_data_url = cache
                .as_ref()
                .and_then(|cache| cache.items.iter().find(|old| old.id == item.article.id))
                .and_then(|old| old.image_data_url.clone());
            if item.article.image_data_url.is_none()
                && let Some(url) = &item.image_url
            {
                item.article.image_data_url =
                    self.0.fetch.get(url, MAX_IMAGE, cancelled).ok().and_then(|image| raster_data_url(&image.bytes));
            }
        }

        let mut merged: HashMap<String, NewsArticle> =
            cache.into_iter().flat_map(|cache| cache.items).map(|item| (item.id.clone(), item)).collect();
        for item in fresh {
            merged.insert(item.article.id.clone(), item.article);
        }
        let cutoff = now - chrono::Duration::days(60);
        let mut items: Vec<_> =
            merged.into_values().filter(|item| article_date(item).is_some_and(|date| date >= cutoff)).collect();
        items.sort_by(|a, b| b.published_at.cmp(&a.published_at).then(a.id.cmp(&b.id)));
        items.truncate(40);
        let cache = NewsCache { configured_url: feed_url.clone(), resolved_url, last_refresh_at: now.to_rfc3339(), items };
        let _guard = self.0.storage.lock().unwrap_or_else(PoisonError::into_inner);
        if cancelled.load(Ordering::SeqCst) || self.0.revision.load(Ordering::SeqCst) != revision {
            return Err(NewsError::Cancelled);
        }
        if atomic_json(&self.0.root, source.filename(), &cache).is_err() {
            return Ok(snapshot(source, &config, Some(&cache), now, false, Some(NewsError::Storage)));
        }
        Ok(snapshot(source, &config, Some(&cache), now, false, None))
    }
    pub fn article_url(&self, source: NewsSource, article_id: &str) -> Result<String, NewsError> {
        let _guard = self.0.storage.lock().unwrap_or_else(PoisonError::into_inner);
        let config = self.config_unlocked()?;
        self.load_cache(source, &config)?
            .and_then(|cache| cache.items.into_iter().find(|item| item.id == article_id))
            .and_then(|item| item.url)
            .and_then(|url| web_url(&url, None, self.0.local_only))
            .ok_or(NewsError::Config)
    }
}
fn valid_request_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 80 && id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}
fn article_date(item: &NewsArticle) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(&item.published_at).ok().map(|date| date.with_timezone(&Utc))
}
fn fresh_cache(cache: &NewsCache, now: DateTime<Utc>) -> bool {
    DateTime::parse_from_rfc3339(&cache.last_refresh_at).ok().is_some_and(|last| {
        let age = now.signed_duration_since(last).num_seconds();
        (0..TTL_SECONDS).contains(&age)
    })
}
fn snapshot(
    source: NewsSource,
    config: &NewsConfig,
    cache: Option<&NewsCache>,
    now: DateTime<Utc>,
    from_cache: bool,
    error: Option<NewsError>,
) -> NewsSnapshot {
    let feed = config.feed(source);
    let fallback = error.is_some();
    let mut items: Vec<_> = cache
        .map(|cache| {
            cache
                .items
                .iter()
                .filter(|item| fallback || article_date(item).is_some_and(|date| date >= now - chrono::Duration::days(60)))
                .cloned()
                .collect()
        })
        .unwrap_or_default();
    items.sort_by(|a, b| b.published_at.cmp(&a.published_at).then(a.id.cmp(&b.id)));
    items.truncate(20);
    NewsSnapshot {
        source,
        title: feed.title.clone(),
        configured_url: feed.url.clone(),
        resolved_url: cache.map(|cache| cache.resolved_url.clone()).unwrap_or_else(|| feed.url.clone()),
        items,
        last_refresh_at: cache.map(|cache| cache.last_refresh_at.clone()),
        from_cache: from_cache && cache.is_some(),
        stale: fallback || cache.is_none_or(|cache| !fresh_cache(cache, now)),
        error,
    }
}
fn load_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<Option<T>, NewsError> {
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(NewsError::Storage),
    };
    if file.metadata().map_err(|_| NewsError::Storage)?.len() > MAX_CACHE {
        return Err(NewsError::Storage);
    }
    serde_json::from_reader(file.take(MAX_CACHE)).map(Some).map_err(|_| NewsError::Storage)
}
static NEXT_WRITE: AtomicU64 = AtomicU64::new(1);
fn atomic_json(root: &Path, name: &str, value: &impl Serialize) -> Result<(), NewsError> {
    std::fs::create_dir_all(root).map_err(|_| NewsError::Storage)?;
    let temporary = root.join(format!("{name}.{}-{}.tmp", std::process::id(), NEXT_WRITE.fetch_add(1, Ordering::Relaxed)));
    let result = (|| {
        let mut file =
            std::fs::OpenOptions::new().create_new(true).write(true).open(&temporary).map_err(|_| NewsError::Storage)?;
        serde_json::to_writer(&mut file, value).map_err(|_| NewsError::Storage)?;
        file.flush().map_err(|_| NewsError::Storage)?;
        file.sync_all().map_err(|_| NewsError::Storage)?;
        drop(file);
        std::fs::rename(&temporary, root.join(name)).map_err(|_| NewsError::Storage)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temporary);
    }
    result
}

/// O Helper aquece as duas fontes um minuto após abrir. Testes não iniciam esta tarefa.
pub(crate) fn prefetch_after_startup(app: AppHandle) {
    if cfg!(test) || crate::test_mode::test_mode().data_dir.is_some() {
        return;
    }
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(60));
        let selected = {
            let state = app.state::<crate::state::AppState>();
            crate::fullscreen::get_config(&state.db()).theme == "aniki"
        };
        if !selected || !app.state::<crate::theme_pack::AnikiPack>().installed() {
            return;
        }
        let news = app.state::<AnikiNewsService>();
        if !news.get_config().is_ok_and(|config| config.enabled) {
            return;
        }
        for (source, request) in [(NewsSource::A, "startup-news-A"), (NewsSource::B, "startup-news-B")] {
            let _ = news.refresh(source, request, false);
        }
    });
}

#[tauri::command]
pub fn aniki_news_get_config(news: State<'_, AnikiNewsService>) -> Result<NewsConfig, NewsError> {
    news.get_config()
}
#[tauri::command]
pub fn aniki_news_set_config(news: State<'_, AnikiNewsService>, config: NewsConfig) -> Result<NewsConfig, NewsError> {
    news.set_config(config)
}
#[tauri::command]
pub fn aniki_news_read(news: State<'_, AnikiNewsService>, source: NewsSource) -> Result<NewsSnapshot, NewsError> {
    news.read(source)
}
#[tauri::command]
pub async fn aniki_news_refresh(
    news: State<'_, AnikiNewsService>,
    source: NewsSource,
    request_id: String,
    force: Option<bool>,
) -> Result<NewsSnapshot, NewsError> {
    let news = news.inner().clone();
    tauri::async_runtime::spawn_blocking(move || news.refresh(source, &request_id, force.unwrap_or(false)))
        .await
        .map_err(|_| NewsError::Fetch)?
}
#[tauri::command]
pub fn aniki_news_cancel(news: State<'_, AnikiNewsService>, request_id: String) {
    news.cancel(&request_id)
}
#[tauri::command]
pub fn aniki_news_open_article(
    app: AppHandle,
    news: State<'_, AnikiNewsService>,
    source: NewsSource,
    article_id: String,
) -> Result<(), NewsError> {
    let url = news.article_url(source, &article_id)?;
    crate::test_hooks::open_in_browser(&app, &url);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 10, 28, 12, 0, 0).unwrap()
    }

    #[test]
    fn rss_content_dates_relative_links_and_safe_reader() {
        let xml = r#"<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item>
        <title>Title &amp; more</title><link>/article</link><pubDate>Tue, 27 Oct 2026 12:00:00 GMT</pubDate>
        <description>Summary</description><content:encoded><![CDATA[<h1>Heading</h1><p>Hello &amp; welcome.</p><script>bad()</script><img src="/photo.png" onerror="bad()"><iframe src="file:///secret">hidden</iframe>]]></content:encoded>
        </item><item><title>Old</title><pubDate>Tue, 01 Sep 2026 12:00:00 GMT</pubDate></item></channel></rss>"#;
        let items = parse_feed(xml.as_bytes(), "https://example.com/feed", now()).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].article.title, "Title & more");
        assert_eq!(items[0].article.url.as_deref(), Some("https://example.com/article"));
        assert_eq!(items[0].article.content_text, "Heading\n\nHello & welcome.");
        assert_eq!(items[0].image_url.as_deref(), Some("https://example.com/photo.png"));
        assert!(items[0].article.image_data_url.is_none());
    }

    #[test]
    fn atom_html_xhtml_and_alternate_link_are_supported_without_external_content() {
        let xml = r#"<feed xmlns="http://www.w3.org/2005/Atom" xml:base="https://example.com/news/"><entry>
          <id>urn:item:1</id><title type="html">A &amp;amp; B</title><link rel="self" href="feed/1"/><link rel="alternate" href="story"/>
          <updated>2026-10-27T12:00:00Z</updated><content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>First</p><p>Second</p></div></content>
        </entry><entry><title>External</title><updated>2026-10-27T12:00:00Z</updated><content src="https://example.com/secret"/><summary>Only summary</summary></entry></feed>"#;
        let items = parse_feed(xml.as_bytes(), "https://example.com/feed", now()).unwrap();
        assert_eq!(items[0].article.title, "A & B");
        assert_eq!(items[0].article.url.as_deref(), Some("https://example.com/news/story"));
        assert_eq!(items[0].article.content_text, "First\n\nSecond");
        assert_eq!(items[1].article.content_text, "Only summary");
        assert!(
            parse_feed(
                b"<!DOCTYPE rss [<!ENTITY x SYSTEM 'file:///secret'>]><rss><channel/></rss>",
                "https://example.com",
                now()
            )
            .is_err()
        );
        assert!(parse_feed(b"<html><item><title>Not a feed</title></item></html>", "https://example.com", now()).is_err());
        assert!(parse_feed(b"<rss><channel><item></channel></rss>", "https://example.com", now()).is_err());
    }

    #[test]
    fn dangerous_urls_and_active_image_formats_are_rejected() {
        for url in [
            "javascript:alert(1)",
            "data:text/html,x",
            "file:///secret",
            "https://user:password@example.com/feed",
            "http://127.0.0.1/x",
            "https://[::1]/x",
            "https://localhost/feed",
        ] {
            assert!(web_url(url, None, false).is_none(), "{url}");
        }
        assert!(web_url("/story", Some("https://example.com/news"), false).is_some());
        assert!(raster_data_url(b"<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>").is_none());
    }

    struct FakeNews {
        calls: Mutex<Vec<String>>,
        response: Mutex<Result<Vec<u8>, NewsError>>,
    }
    impl NewsFetch for FakeNews {
        fn get(&self, url: &str, _: usize, cancelled: &AtomicBool) -> Result<FetchedNews, NewsError> {
            if cancelled.load(Ordering::Relaxed) {
                return Err(NewsError::Cancelled);
            }
            self.calls.lock().unwrap().push(url.into());
            self.response.lock().unwrap().clone().map(|bytes| FetchedNews { bytes, url: url.into() })
        }
    }
    fn rss(count: usize, date: DateTime<Utc>) -> Vec<u8> {
        format!("<rss><channel>{}</channel></rss>", (0..count).map(|i| format!("<item><title>Item {i}</title><link>https://example.com/{i}</link><pubDate>{}</pubDate><description>Body</description></item>", date.to_rfc2822())).collect::<String>()).into_bytes()
    }
    fn fake() -> Arc<FakeNews> {
        Arc::new(FakeNews { calls: Mutex::new(vec![]), response: Mutex::new(Ok(rss(30, now()))) })
    }

    #[test]
    fn cache_ttl_display_and_merge_keep_40_with_60_days_of_history() {
        let folder = crate::test_support::temp_folder("news-cache");
        let transport = fake();
        let service = AnikiNewsService::with_fetch(folder.clone(), transport.clone(), false);
        let first = service.refresh_at(NewsSource::A, "first", false, now()).unwrap();
        assert_eq!(first.items.len(), 20);
        assert!(!first.from_cache);
        assert_eq!(transport.calls.lock().unwrap().len(), 1);
        let cached = service.refresh_at(NewsSource::A, "cached", false, now() + chrono::Duration::hours(2)).unwrap();
        assert!(cached.from_cache && !cached.stale);
        assert_eq!(transport.calls.lock().unwrap().len(), 1);
        let later = now() + chrono::Duration::days(40);
        *transport.response.lock().unwrap() = Ok(rss(30, later));
        service.refresh_at(NewsSource::A, "merge", true, later).unwrap();
        let cache = service.load_cache(NewsSource::A, &NewsConfig::default()).unwrap().unwrap();
        assert_eq!(cache.items.len(), 40);
        assert!(cache.items.iter().any(|item| item.published_at == now().to_rfc3339()));
        let latest = now() + chrono::Duration::days(61);
        *transport.response.lock().unwrap() = Ok(rss(1, latest));
        service.refresh_at(NewsSource::A, "purge", true, latest).unwrap();
        let cache = service.load_cache(NewsSource::A, &NewsConfig::default()).unwrap().unwrap();
        assert_eq!(cache.items.len(), 31);
        assert!(!cache.items.iter().any(|item| item.published_at == now().to_rfc3339()));
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn failure_keeps_stale_cache_and_changed_url_never_shows_old_source() {
        let folder = crate::test_support::temp_folder("news-fallback");
        let transport = fake();
        let service = AnikiNewsService::with_fetch(folder.clone(), transport.clone(), false);
        service.refresh_at(NewsSource::A, "initial", false, now()).unwrap();
        *transport.response.lock().unwrap() = Err(NewsError::Fetch);
        let failed = service.refresh_at(NewsSource::A, "failed", true, now() + chrono::Duration::days(90)).unwrap();
        assert!(failed.from_cache && failed.stale);
        assert_eq!(failed.items.len(), 20);
        assert_eq!(failed.error, Some(NewsError::Fetch));
        let mut config = service.get_config().unwrap();
        config.source_a.url = "https://example.com/other.xml".into();
        config.source_a.title = "Custom".into();
        service.set_config(config.clone()).unwrap();
        assert!(service.read_at(NewsSource::A, now()).unwrap().items.is_empty());
        *transport.response.lock().unwrap() = Ok(rss(1, now()));
        let result = service.refresh_at(NewsSource::A, "new-source", true, now()).unwrap();
        assert_eq!(result.title, "Custom");
        assert_eq!(result.configured_url, config.source_a.url);
        config.enabled = false;
        service.set_config(config).unwrap();
        let calls = transport.calls.lock().unwrap().len();
        service.refresh_at(NewsSource::A, "disabled", true, now()).unwrap();
        assert_eq!(transport.calls.lock().unwrap().len(), calls);
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn custom_feed_uses_default_on_failure_and_cancel_never_commits() {
        struct FeedFallback;
        impl NewsFetch for FeedFallback {
            fn get(&self, url: &str, _: usize, _: &AtomicBool) -> Result<FetchedNews, NewsError> {
                if url != DEFAULT_A {
                    return Err(NewsError::Fetch);
                }
                Ok(FetchedNews { bytes: rss(1, now()), url: url.into() })
            }
        }
        let folder = crate::test_support::temp_folder("news-cancel");
        let service = AnikiNewsService::with_fetch(folder.clone(), Arc::new(FeedFallback), false);
        let mut config = NewsConfig::default();
        config.source_a.url = "https://example.com/feed".into();
        service.set_config(config).unwrap();
        let result = service.refresh_at(NewsSource::A, "fallback", true, now()).unwrap();
        assert_eq!(result.resolved_url, DEFAULT_A);
        service.cancel("early");
        assert!(matches!(service.refresh_at(NewsSource::A, "early", true, now()), Err(NewsError::Cancelled)));
        struct CancelDuring;
        impl NewsFetch for CancelDuring {
            fn get(&self, url: &str, _: usize, cancelled: &AtomicBool) -> Result<FetchedNews, NewsError> {
                cancelled.store(true, Ordering::Relaxed);
                Ok(FetchedNews { bytes: rss(1, now()), url: url.into() })
            }
        }
        let service = AnikiNewsService::with_fetch(folder.clone(), Arc::new(CancelDuring), false);
        let before = std::fs::read(folder.join(NewsSource::A.filename())).unwrap();
        assert!(matches!(service.refresh_at(NewsSource::A, "during", true, now()), Err(NewsError::Cancelled)));
        assert_eq!(std::fs::read(folder.join(NewsSource::A.filename())).unwrap(), before);
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn production_transport_in_tests_only_reaches_explicit_localhost_and_validates_raster() {
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}/feed", listener.local_addr().unwrap());
        let worker = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 4096];
            let _ = stream.read(&mut request);
            let body = rss(1, now());
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/rss+xml\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            )
            .unwrap();
            stream.write_all(&body).unwrap();
        });
        let transport = HttpNewsFetch::new(true);
        let result = transport.get(&address, MAX_FEED, &AtomicBool::new(false)).unwrap();
        assert_eq!(parse_feed(&result.bytes, &result.url, now()).unwrap().len(), 1);
        worker.join().unwrap();
        assert!(transport.get(DEFAULT_A, MAX_FEED, &AtomicBool::new(false)).is_err());
        let mut bytes = Cursor::new(vec![]);
        image::DynamicImage::new_rgb8(4, 4).write_to(&mut bytes, image::ImageFormat::Png).unwrap();
        assert!(raster_data_url(bytes.get_ref()).unwrap().starts_with("data:image/jpeg;base64,"));
    }

    #[test]
    fn corrupt_cache_can_be_refreshed_and_article_open_resolves_only_saved_safe_ids() {
        let folder = crate::test_support::temp_folder("news-corrupt");
        std::fs::write(folder.join(NewsSource::A.filename()), "{broken").unwrap();
        let service = AnikiNewsService::with_fetch(folder.clone(), fake(), false);
        let read = service.read_at(NewsSource::A, now()).unwrap();
        assert_eq!(read.error, Some(NewsError::Storage));
        assert!(read.items.is_empty());
        let result = service.refresh_at(NewsSource::A, "recover", true, now()).unwrap();
        assert_eq!(result.items.len(), 20);
        assert!(service.article_url(NewsSource::A, &result.items[0].id).unwrap().starts_with("https://example.com/"));
        assert_eq!(service.article_url(NewsSource::A, "https://evil.example/"), Err(NewsError::Config));
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn changing_config_while_fetch_is_running_cancels_before_persisting() {
        use std::sync::Barrier;
        struct Blocking {
            entered: Arc<Barrier>,
            finish: Arc<Barrier>,
        }
        impl NewsFetch for Blocking {
            fn get(&self, url: &str, _: usize, _: &AtomicBool) -> Result<FetchedNews, NewsError> {
                self.entered.wait();
                self.finish.wait();
                Ok(FetchedNews { bytes: rss(1, now()), url: url.into() })
            }
        }
        let folder = crate::test_support::temp_folder("news-config-race");
        let entered = Arc::new(Barrier::new(2));
        let finish = Arc::new(Barrier::new(2));
        let service = AnikiNewsService::with_fetch(
            folder.clone(),
            Arc::new(Blocking { entered: entered.clone(), finish: finish.clone() }),
            false,
        );
        let worker_service = service.clone();
        let worker = std::thread::spawn(move || worker_service.refresh_at(NewsSource::A, "racing", true, now()));
        entered.wait();
        let mut config = NewsConfig::default();
        config.source_a.url = "https://example.com/changed".into();
        service.set_config(config).unwrap();
        finish.wait();
        assert!(matches!(worker.join().unwrap(), Err(NewsError::Cancelled)));
        assert!(!folder.join(NewsSource::A.filename()).exists());
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn test_service_defaults_never_fetch_public_feeds_and_cancel_tombstones_are_bounded() {
        let folder = crate::test_support::temp_folder("news-test-mode");
        let service = AnikiNewsService::new(folder.clone());
        assert!(service.0.local_only);
        let result = service.refresh_at(NewsSource::A, "public-blocked", true, now()).unwrap();
        assert_eq!(result.error, Some(NewsError::Fetch));
        let service = AnikiNewsService::with_fetch(folder.clone(), fake(), false);
        for id in 0..300 {
            service.cancel(&format!("already-completed-{id}"));
        }
        assert!(service.refresh_at(NewsSource::A, "new-read", true, now()).is_ok());
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn thumbnail_json_payload_has_a_hard_size_limit() {
        let pixels = (0..640 * 360 * 3)
            .map(|i| ((i as u32).wrapping_mul(2_654_435_761).rotate_left((i % 29) as u32) >> 24) as u8)
            .collect();
        let image = image::RgbImage::from_raw(640, 360, pixels).unwrap();
        let mut bytes = Cursor::new(vec![]);
        image::DynamicImage::ImageRgb8(image).write_to(&mut bytes, image::ImageFormat::Png).unwrap();
        let url = raster_data_url(bytes.get_ref()).unwrap();
        assert!(BASE64.decode(url.split_once(',').unwrap().1).unwrap().len() <= 64 * 1024);
    }

    #[test]
    fn localhost_fixture_runs_full_service_and_only_exposes_reencoded_images() {
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        let fixture_base = address.clone();
        let worker = std::thread::spawn(move || {
            let mut image = Cursor::new(vec![]);
            image::DynamicImage::new_rgb8(4, 4).write_to(&mut image, image::ImageFormat::Png).unwrap();
            let feed = format!(
                "<rss><channel><item><title>Local article</title><link>{fixture_base}/article</link><pubDate>{}</pubDate><enclosure url='/photo.png' type='image/png'/><description><![CDATA[<p>Visible</p><script>hidden()</script>]]></description></item></channel></rss>",
                now().to_rfc2822()
            );
            let deadline = std::time::Instant::now() + Duration::from_secs(5);
            let mut count = 0;
            while count < 2 && std::time::Instant::now() < deadline {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        stream.set_nonblocking(false).unwrap();
                        stream.set_read_timeout(Some(Duration::from_secs(1))).unwrap();
                        let mut request = [0; 4096];
                        let size = stream.read(&mut request).unwrap();
                        let photo = String::from_utf8_lossy(&request[..size]).starts_with("GET /photo.png ");
                        let body = if photo { image.get_ref().clone() } else { feed.as_bytes().to_vec() };
                        write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).unwrap();
                        stream.write_all(&body).unwrap();
                        count += 1;
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(5)),
                    Err(error) => panic!("{error}"),
                }
            }
            count
        });
        let folder = crate::test_support::temp_folder("news-local-image");
        let service = AnikiNewsService::new(folder.clone());
        let mut config = NewsConfig::default();
        config.source_a.url = format!("{address}/feed");
        service.set_config(config).unwrap();
        let result = service.refresh_at(NewsSource::A, "local-image", true, now()).unwrap();
        assert_eq!(worker.join().unwrap(), 2);
        assert_eq!(result.items[0].content_text, "Visible");
        assert!(result.items[0].image_data_url.as_ref().unwrap().starts_with("data:image/jpeg;base64,"));
        assert_eq!(service.article_url(NewsSource::A, &result.items[0].id).unwrap(), format!("{address}/article"));
        std::fs::remove_dir_all(folder).unwrap();
    }
}
