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

        public override IEnumerable<GameMetadata> GetGames(LibraryGetGamesArgs args)
        {
            return LibraryFile.Read(LibraryPath).Select(LibraryFile.ToMetadata).ToList();
        }

        public override void OnLibraryUpdated(OnLibraryUpdatedEventArgs args)
        {
            var database = PlayniteApi.Database;
            var imported = database.Games.Where(game => game.PluginId == PluginGuid).ToList();
            Guid? StatusId(string name) => database.CompletionStatuses.FirstOrDefault(status => status.Name == name)?.Id;
            var plan = LibrarySync.Plan(imported, LibraryFile.Read(LibraryPath), StatusId);
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
    }
}
