using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Playnite.SDK;
using Playnite.SDK.Events;
using Playnite.SDK.Models;
using Playnite.SDK.Plugins;

namespace PlaytroveBridge
{
    /// <summary>
    /// A biblioteca "Playtrove" do Playnite: os jogos chegam do library.json que o Playtrove grava na
    /// pasta de dados deste plugin, e o Playnite baixa capas e metadados sozinho, como faz com qualquer
    /// biblioteca.
    /// </summary>
    public class PlaytroveLibrary : LibraryPlugin
    {
        public static readonly Guid PluginGuid = new Guid("7b0d4c1e-2f58-4a3b-9d61-8c5e0a2f7b93");

        public override Guid Id => PluginGuid;

        public override string Name => "Playtrove";

        public PlaytroveLibrary(IPlayniteAPI api) : base(api)
        {
            Properties = new LibraryPluginProperties { HasSettings = false, CanShutdownClient = false };
        }

        private string LibraryPath => Path.Combine(GetPluginUserDataPath(), "library.json");

        private bool syncing;

        private PlaytroveClient Playtrove => new PlaytroveClient(Path.Combine(GetPluginUserDataPath(), "bridge.json"));

        public override IEnumerable<GameMetadata> GetGames(LibraryGetGamesArgs args)
        {
            return LibraryFile.Read(LibraryPath).Select(LibraryFile.ToMetadata).ToList();
        }

        public override IEnumerable<PlayController> GetPlayActions(GetPlayActionsArgs args)
        {
            if (args.Game.PluginId == PluginGuid)
            {
                yield return new PlaytrovePlayController(args.Game, Playtrove, PlayniteApi);
            }
        }

        public override void OnApplicationStarted(OnApplicationStartedEventArgs args)
        {
            PlayniteApi.Database.Games.ItemUpdated += (sender, update) =>
            {
                foreach (var item in update.UpdatedItems)
                {
                    // O que o próprio plugin grava com os dados do Playtrove não volta para ele.
                    if (!syncing && item.NewData.PluginId == PluginGuid && GameChange.Changed(item.OldData, item.NewData))
                    {
                        SendChange(item.OldData, item.NewData);
                    }
                }
            };
        }

        private void SendChange(Game before, Game after)
        {
            var status = before.CompletionStatusId == after.CompletionStatusId
                ? null
                : GameChange.Preset(PlayniteApi.Database.CompletionStatuses.Get(after.CompletionStatusId)?.Name);
            var change = new GameChange
            {
                Id = long.Parse(after.GameId, System.Globalization.CultureInfo.InvariantCulture),
                Favorite = after.Favorite,
                StatusPreset = status,
                Rating = GameChange.ToRating(after.UserScore),
            };
            System.Threading.Tasks.Task.Run(() =>
            {
                try { Playtrove.Update(change); }
                catch (PlaytroveException) { /* Com o Playtrove fechado, a mudança fica só no Playnite. */ }
            });
        }

        public override void OnLibraryUpdated(OnLibraryUpdatedEventArgs args)
        {
            var database = PlayniteApi.Database;
            var imported = database.Games.Where(game => game.PluginId == PluginGuid).ToList();
            Guid? StatusId(string name) => database.CompletionStatuses.FirstOrDefault(status => status.Name == name)?.Id;
            var plan = LibrarySync.Plan(imported, LibraryFile.Read(LibraryPath), StatusId);
            syncing = true;
            try
            {
                using (database.BufferedUpdate())
                {
                    foreach (var game in plan.Updated)
                    {
                        database.Games.Update(game);
                    }
                    foreach (var game in plan.Removed)
                    {
                        database.Games.Remove(game.Id);
                    }
                }
            }
            finally
            {
                syncing = false;
            }
        }
    }
}
