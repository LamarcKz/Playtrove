using System;
using System.IO;
using System.Net.Http;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;

namespace PlaytroveBridge
{
    /// <summary>Um erro que o Playtrove devolveu (já no idioma do app) ou a falta dele.</summary>
    public class PlaytroveException : Exception
    {
        public PlaytroveException(string message) : base(message) { }
    }

    [DataContract]
    internal class BridgeConfig
    {
        [DataMember(Name = "port")] public int Port { get; set; }
        [DataMember(Name = "token")] public string Token { get; set; }
    }

    [DataContract]
    internal class PlayReply
    {
        [DataMember(Name = "processId")] public int ProcessId { get; set; }
    }

    [DataContract]
    internal class ErrorReply
    {
        [DataMember(Name = "error")] public string Error { get; set; }
    }

    [DataContract]
    internal class PlayRequest
    {
        [DataMember(Name = "id")] public long Id { get; set; }
    }

    /// <summary>
    /// Fala com o servidor local do Playtrove (só 127.0.0.1). A porta e o token mudam a cada entrada no
    /// Aniki e ficam no bridge.json da pasta de dados do plugin.
    /// </summary>
    public class PlaytroveClient
    {
        private static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        private readonly string configPath;

        public PlaytroveClient(string configPath)
        {
            this.configPath = configPath;
        }

        /// <summary>Pede ao Playtrove para abrir o jogo; devolve o processo do emulador.</summary>
        public int Play(long gameId)
        {
            var body = Send("/play", new PlayRequest { Id = gameId });
            return Read<PlayReply>(body).ProcessId;
        }

        /// <summary>Devolve ao Playtrove o favorito, o status e a nota mudados no Aniki.</summary>
        public void Update(GameChange change)
        {
            Send("/game", change);
        }

        private string Send<T>(string path, T payload)
        {
            BridgeConfig config;
            try
            {
                using (var stream = File.OpenRead(configPath))
                {
                    config = (BridgeConfig)new DataContractJsonSerializer(typeof(BridgeConfig)).ReadObject(stream);
                }
            }
            catch (Exception)
            {
                throw new PlaytroveException("O Playtrove não está aberto.");
            }
            using (var request = new HttpRequestMessage(HttpMethod.Post, "http://127.0.0.1:" + config.Port + path))
            {
                request.Headers.Add("X-Playtrove-Token", config.Token);
                request.Content = new StringContent(Write(payload), Encoding.UTF8, "application/json");
                HttpResponseMessage response;
                try
                {
                    response = Http.SendAsync(request).GetAwaiter().GetResult();
                }
                catch (Exception)
                {
                    throw new PlaytroveException("O Playtrove não está aberto.");
                }
                using (response)
                {
                    var text = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                    if (!response.IsSuccessStatusCode)
                    {
                        var error = string.IsNullOrEmpty(text) ? null : Read<ErrorReply>(text)?.Error;
                        throw new PlaytroveException(error ?? "O Playtrove recusou o pedido.");
                    }
                    return text;
                }
            }
        }

        private static string Write<T>(T value)
        {
            using (var stream = new MemoryStream())
            {
                new DataContractJsonSerializer(typeof(T)).WriteObject(stream, value);
                return Encoding.UTF8.GetString(stream.ToArray());
            }
        }

        private static T Read<T>(string text)
        {
            using (var stream = new MemoryStream(Encoding.UTF8.GetBytes(text)))
            {
                return (T)new DataContractJsonSerializer(typeof(T)).ReadObject(stream);
            }
        }
    }
}
