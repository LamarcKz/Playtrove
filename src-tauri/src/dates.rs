//! Datas no formato que o banco guarda: ISO, em UTC e com milésimos (o toISOString() do JavaScript,
//! ex.: 2026-10-21T12:34:56.789Z), para os dois apps gravarem igual.

use chrono::{DateTime, SecondsFormat, Utc};

pub fn iso(date: DateTime<Utc>) -> String {
    date.to_rfc3339_opts(SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grava_como_o_javascript() {
        let date = DateTime::parse_from_rfc3339("2026-10-21T12:34:56.789Z").unwrap().with_timezone(&Utc);
        assert_eq!(iso(date), "2026-10-21T12:34:56.789Z");
    }
}
