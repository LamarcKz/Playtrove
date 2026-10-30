using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Xunit;

namespace PlaytroveBridge.Tests
{
    public class PlaytroveClientTests
    {
        /// <summary>Um Playtrove de mentira: responde um pedido com o que foi combinado e guarda o que chegou.</summary>
        private sealed class FakePlaytrove : IDisposable
        {
            private readonly TcpListener listener = new TcpListener(IPAddress.Loopback, 0);
            public List<string> Requests { get; } = new List<string>();
            public string ConfigPath { get; }

            public FakePlaytrove(int status, string body)
            {
                listener.Start();
                var port = ((IPEndPoint)listener.LocalEndpoint).Port;
                ConfigPath = Path.Combine(Path.GetTempPath(), "playtrove-bridge-" + Guid.NewGuid() + ".json");
                File.WriteAllText(ConfigPath, "{\"port\":" + port + ",\"token\":\"segredo\"}");
                Task.Run(() =>
                {
                    using (var client = listener.AcceptTcpClient())
                    using (var stream = client.GetStream())
                    {
                        var buffer = new byte[8192];
                        var read = stream.Read(buffer, 0, buffer.Length);
                        var text = Encoding.UTF8.GetString(buffer, 0, read);
                        if (!text.Contains("\r\n\r\n{")) // o corpo pode chegar num segundo pacote
                        {
                            read = stream.Read(buffer, 0, buffer.Length);
                            text += Encoding.UTF8.GetString(buffer, 0, read);
                        }
                        lock (Requests) { Requests.Add(text); }
                        var answer = Encoding.UTF8.GetBytes(body);
                        var head = Encoding.ASCII.GetBytes("HTTP/1.1 " + status + " X\r\nContent-Length: " + answer.Length + "\r\nConnection: close\r\n\r\n");
                        stream.Write(head, 0, head.Length);
                        stream.Write(answer, 0, answer.Length);
                    }
                });
            }

            public void Dispose() => listener.Stop();
        }

        [Fact]
        public void PlayDevolveOProcessoEMandaOToken()
        {
            using (var fake = new FakePlaytrove(200, "{\"processId\":4242}"))
            {
                Assert.Equal(4242, new PlaytroveClient(fake.ConfigPath).Play(7));
                var request = fake.Requests[0];
                Assert.StartsWith("POST /play ", request);
                Assert.Contains("X-Playtrove-Token: segredo", request);
                Assert.Contains("{\"id\":7}", request);
            }
        }

        [Fact]
        public void JogoAbertoViraOErroDoPlaytrove()
        {
            using (var fake = new FakePlaytrove(409, "{\"error\":\"Já tem um jogo aberto.\"}"))
            {
                var error = Assert.Throws<PlaytroveException>(() => new PlaytroveClient(fake.ConfigPath).Play(7));
                Assert.Equal("Já tem um jogo aberto.", error.Message);
            }
        }

        [Fact]
        public void PlaytroveFechadoViraErro()
        {
            var config = Path.Combine(Path.GetTempPath(), "nao-existe-" + Guid.NewGuid() + ".json");
            Assert.Throws<PlaytroveException>(() => new PlaytroveClient(config).Play(7));
        }

        [Fact]
        public void UpdateMandaFavoritoStatusENota()
        {
            using (var fake = new FakePlaytrove(204, ""))
            {
                new PlaytroveClient(fake.ConfigPath).Update(new GameChange { Id = 3, Favorite = true, StatusPreset = "beaten", Rating = 7 });
                var request = fake.Requests[0];
                Assert.StartsWith("POST /game ", request);
                Assert.Contains("\"id\":3", request);
                Assert.Contains("\"favorite\":true", request);
                Assert.Contains("\"statusPreset\":\"beaten\"", request);
                Assert.Contains("\"rating\":7", request);
            }
        }
    }

    public class PlaySessionTests
    {
        [Fact]
        public void AbreAvisaQueComecouEQueTerminou()
        {
            var events = new List<string>();
            var exit = new TaskCompletionSource<bool>();
            var session = PlaySession.Run(
                play: () => 4242,
                started: pid => events.Add("começou " + pid),
                stopped: () => events.Add("terminou"),
                failed: message => events.Add("falhou " + message),
                waitForExit: pid => exit.Task);
            Assert.Equal(new[] { "começou 4242" }, events);
            exit.SetResult(true);
            session.Wait(TimeSpan.FromSeconds(5));
            Assert.Equal(new[] { "começou 4242", "terminou" }, events);
        }

        [Fact]
        public void FalhaAvisaETerminaSemComecar()
        {
            var events = new List<string>();
            var session = PlaySession.Run(
                play: () => throw new PlaytroveException("Já tem um jogo aberto."),
                started: pid => events.Add("começou"),
                stopped: () => events.Add("terminou"),
                failed: message => events.Add("falhou " + message),
                waitForExit: pid => Task.FromResult(true));
            session.Wait(TimeSpan.FromSeconds(5));
            Assert.Equal(new[] { "falhou Já tem um jogo aberto.", "terminou" }, events);
        }
    }

    public class GameChangeTests
    {
        [Fact]
        public void SoFavoritoStatusOuNotaContamComoMudanca()
        {
            var before = new Playnite.SDK.Models.Game("Jogo") { Favorite = false, UserScore = 70, Playtime = 10 };
            var after = new Playnite.SDK.Models.Game("Jogo") { Favorite = false, UserScore = 70, Playtime = 99 };
            Assert.False(GameChange.Changed(before, after));
            after.Favorite = true;
            Assert.True(GameChange.Changed(before, after));
        }

        [Theory]
        [InlineData(70, 7)]
        [InlineData(75, 8)]
        [InlineData(null, null)]
        public void NotaDoPlayniteNaEscalaDoPlaytrove(int? score, int? rating)
        {
            Assert.Equal(rating, GameChange.ToRating(score));
        }
    }
}
