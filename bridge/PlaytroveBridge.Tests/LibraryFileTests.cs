using System;
using System.IO;
using System.Linq;
using Playnite.SDK.Models;
using Xunit;

namespace PlaytroveBridge.Tests
{
    public class LibraryFileTests
    {
        private const string Json = @"{
  ""version"": 1,
  ""games"": [
    { ""id"": 7, ""title"": ""Ação Fictícia"", ""platform"": ""Nintendo SNES"", ""platformSpec"": ""nintendo_super_nes"",
      ""playtimeSeconds"": 3600, ""lastPlayedAt"": ""2026-10-20T12:00:00Z"", ""addedAt"": ""2026-01-02T03:04:05Z"",
      ""statusPreset"": ""goingFor100"", ""favorite"": true, ""rating"": 7 },
    { ""id"": 8, ""title"": ""Sem Nota"", ""platform"": ""Plataforma Nova"", ""platformSpec"": null,
      ""playtimeSeconds"": 0, ""lastPlayedAt"": null, ""addedAt"": null,
      ""statusPreset"": null, ""favorite"": false, ""rating"": null }
  ]
}";

        private static string WriteFile(string text)
        {
            var path = Path.Combine(Path.GetTempPath(), "playtrove-bridge-" + Guid.NewGuid() + ".json");
            File.WriteAllText(path, text, new System.Text.UTF8Encoding(false));
            return path;
        }

        [Fact]
        public void LeOsJogosComAcentos()
        {
            var games = LibraryFile.Read(WriteFile(Json));
            Assert.Equal(2, games.Count);
            Assert.Equal("Ação Fictícia", games[0].Title);
            Assert.Equal(7, games[0].Id);
        }

        [Fact]
        public void ArquivoQueNaoExisteEUmaBibliotecaVazia()
        {
            Assert.Empty(LibraryFile.Read(Path.Combine(Path.GetTempPath(), "nao-existe-" + Guid.NewGuid() + ".json")));
        }

        [Fact]
        public void LevaSoOsDadosDoPlaytrove()
        {
            var game = LibraryFile.Read(WriteFile(Json))[0];
            var metadata = LibraryFile.ToMetadata(game);
            Assert.Equal("7", metadata.GameId);
            Assert.Equal("Ação Fictícia", metadata.Name);
            Assert.True(metadata.IsInstalled);
            Assert.Equal(3600UL, metadata.Playtime);
            Assert.Equal(new DateTime(2026, 10, 20, 12, 0, 0, DateTimeKind.Utc), metadata.LastActivity.Value.ToUniversalTime());
            Assert.True(metadata.Favorite);
            Assert.Equal(70, metadata.UserScore);
            var platform = Assert.IsType<MetadataSpecProperty>(metadata.Platforms.Single());
            Assert.Equal("nintendo_super_nes", platform.Id);
            Assert.Equal("Playing", ((MetadataNameProperty)metadata.CompletionStatus).Name);
            // Capa, fundo e descrição ficam com o Playnite e os complementos.
            Assert.Null(metadata.CoverImage);
            Assert.Null(metadata.BackgroundImage);
            Assert.Null(metadata.Description);
        }

        [Fact]
        public void SemNotaSemStatusEComPlataformaPeloNome()
        {
            var metadata = LibraryFile.ToMetadata(LibraryFile.Read(WriteFile(Json))[1]);
            Assert.Null(metadata.UserScore);
            Assert.Null(metadata.CompletionStatus);
            Assert.Null(metadata.LastActivity);
            Assert.Equal("Plataforma Nova", Assert.IsType<MetadataNameProperty>(metadata.Platforms.Single()).Name);
        }

        [Theory]
        [InlineData("planToPlay", "Plan to Play")]
        [InlineData("onHold", "On Hold")]
        [InlineData("abandoned", "Abandoned")]
        [InlineData("playing", "Playing")]
        [InlineData("goingFor100", "Playing")]
        [InlineData("goingForPlatinum", "Playing")]
        [InlineData("beaten", "Beaten")]
        [InlineData("complete100", "Completed")]
        [InlineData("platinum", "Completed")]
        public void StatusPadraoViramOsDoPlaynite(string preset, string expected)
        {
            Assert.Equal(expected, LibraryFile.StatusName(preset));
        }

        [Fact]
        public void StatusCriadoPeloUsuarioNaoTemEquivalente()
        {
            Assert.Null(LibraryFile.StatusName(null));
            Assert.Null(LibraryFile.StatusName("outro"));
        }
    }
}
