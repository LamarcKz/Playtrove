using System;
using System.Collections.Generic;
using System.Linq;
using Playnite.SDK.Models;
using Xunit;

namespace PlaytroveBridge.Tests
{
    public class LibrarySyncTests
    {
        private static LibraryGame Entry(long id, ulong playtime, bool favorite) =>
            new LibraryGame { Id = id, Title = "Jogo " + id, Platform = "Sony PSP", PlaytimeSeconds = playtime, Favorite = favorite };

        private static Game Imported(string gameId) => new Game("Jogo " + gameId) { GameId = gameId, PluginId = PlaytroveLibrary.PluginGuid };

        [Fact]
        public void JogoQueSaiuDoPlaytroveSaiDoPlaynite()
        {
            var plan = LibrarySync.Plan(new[] { Imported("1"), Imported("2") }, new[] { Entry(1, 10, false) });
            Assert.Equal(new[] { "2" }, plan.Removed.Select(game => game.GameId));
        }

        [Fact]
        public void JogoQueContinuaRecebeOsDadosNovosDoPlaytrove()
        {
            var game = Imported("1");
            game.Playtime = 5;
            var plan = LibrarySync.Plan(new[] { game }, new[] { Entry(1, 120, true) });
            var updated = plan.Updated.Single();
            Assert.Same(game, updated);
            Assert.Equal(120UL, updated.Playtime);
            Assert.True(updated.Favorite);
            Assert.Empty(plan.Removed);
        }

        [Fact]
        public void JogoSemMudancaNaoEGravadoDeNovo()
        {
            var game = Imported("1");
            game.Playtime = 120;
            game.Favorite = true;
            var plan = LibrarySync.Plan(new[] { game }, new[] { Entry(1, 120, true) });
            Assert.Empty(plan.Updated);
        }
    }
}
