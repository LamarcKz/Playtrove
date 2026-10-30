using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Playnite.SDK.Models;

namespace PlaytroveBridge
{
    /// <summary>O que muda nos jogos já importados: os dados novos do Playtrove e os que saíram dele.</summary>
    public class SyncPlan
    {
        public List<Game> Updated { get; } = new List<Game>();
        public List<Game> Removed { get; } = new List<Game>();
    }

    public static class LibrarySync
    {
        /// <summary>
        /// O Playnite só importa jogos novos; para os que já estão nele, o tempo jogado, a última vez,
        /// o favorito, a nota e o status passam a ser os do Playtrove. <paramref name="statusId"/> acha o
        /// status pelo nome no banco do Playnite.
        /// </summary>
        public static SyncPlan Plan(IEnumerable<Game> imported, IEnumerable<LibraryGame> entries, Func<string, Guid?> statusId = null)
        {
            var plan = new SyncPlan();
            var byId = entries.ToDictionary(entry => entry.Id.ToString(CultureInfo.InvariantCulture));
            foreach (var game in imported)
            {
                if (!byId.TryGetValue(game.GameId ?? "", out var entry))
                {
                    plan.Removed.Add(game);
                    continue;
                }
                var changed = false;
                void Set<T>(T current, T next, Action<T> apply)
                {
                    if (!EqualityComparer<T>.Default.Equals(current, next))
                    {
                        apply(next);
                        changed = true;
                    }
                }
                Set(game.Playtime, entry.PlaytimeSeconds, value => game.Playtime = value);
                Set(game.LastActivity, LibraryFile.Date(entry.LastPlayedAt), value => game.LastActivity = value);
                Set(game.Favorite, entry.Favorite, value => game.Favorite = value);
                Set(game.UserScore, LibraryFile.Score(entry), value => game.UserScore = value);
                var status = LibraryFile.StatusName(entry.StatusPreset);
                var id = status == null || statusId == null ? null : statusId(status);
                if (id.HasValue)
                {
                    Set(game.CompletionStatusId, id.Value, value => game.CompletionStatusId = value);
                }
                if (changed)
                {
                    plan.Updated.Add(game);
                }
            }
            return plan;
        }
    }
}
