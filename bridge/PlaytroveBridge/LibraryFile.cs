using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using Playnite.SDK.Models;

namespace PlaytroveBridge
{
    /// <summary>Um jogo do library.json que o Playtrove grava a cada entrada no Aniki.</summary>
    [DataContract]
    public class LibraryGame
    {
        [DataMember(Name = "id")] public long Id { get; set; }
        [DataMember(Name = "title")] public string Title { get; set; }
        [DataMember(Name = "platform")] public string Platform { get; set; }
        [DataMember(Name = "platformSpec")] public string PlatformSpec { get; set; }
        [DataMember(Name = "playtimeSeconds")] public ulong PlaytimeSeconds { get; set; }
        [DataMember(Name = "lastPlayedAt")] public string LastPlayedAt { get; set; }
        [DataMember(Name = "addedAt")] public string AddedAt { get; set; }
        [DataMember(Name = "statusPreset")] public string StatusPreset { get; set; }
        [DataMember(Name = "favorite")] public bool Favorite { get; set; }
        [DataMember(Name = "rating")] public int? Rating { get; set; }
    }

    [DataContract]
    internal class LibraryDocument
    {
        [DataMember(Name = "version")] public int Version { get; set; }
        [DataMember(Name = "games")] public List<LibraryGame> Games { get; set; }
    }

    /// <summary>
    /// Lê o library.json e converte cada jogo no que o Playnite importa. Só vão os dados do Playtrove:
    /// capa, fundo, descrição e o resto ficam com o Playnite e os complementos, como no original.
    /// </summary>
    public static class LibraryFile
    {
        public static IReadOnlyList<LibraryGame> Read(string path)
        {
            if (!File.Exists(path))
            {
                return new List<LibraryGame>();
            }
            using (var stream = File.OpenRead(path))
            {
                var document = (LibraryDocument)new DataContractJsonSerializer(typeof(LibraryDocument)).ReadObject(stream);
                return document?.Games ?? new List<LibraryGame>();
            }
        }

        /// <summary>Os status padrão do Playtrove (pela marca preset) nos que o Playnite cria no banco.</summary>
        public static string StatusName(string preset)
        {
            switch (preset)
            {
                case "planToPlay": return "Plan to Play";
                case "onHold": return "On Hold";
                case "abandoned": return "Abandoned";
                case "playing":
                case "goingFor100":
                case "goingForPlatinum": return "Playing";
                case "beaten": return "Beaten";
                case "complete100":
                case "platinum": return "Completed";
                default: return null;
            }
        }

        /// <summary>A nota do Playtrove (1 a 10) na escala do Playnite (0 a 100).</summary>
        public static int? Score(LibraryGame game) => game.Rating * 10;

        public static DateTime? Date(string text)
        {
            if (string.IsNullOrEmpty(text) ||
                !DateTime.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var date))
            {
                return null;
            }
            return date.ToLocalTime();
        }

        public static GameMetadata ToMetadata(LibraryGame game)
        {
            var status = StatusName(game.StatusPreset);
            MetadataProperty platform = string.IsNullOrEmpty(game.PlatformSpec)
                ? (MetadataProperty)new MetadataNameProperty(game.Platform)
                : new MetadataSpecProperty(game.PlatformSpec);
            return new GameMetadata
            {
                GameId = game.Id.ToString(CultureInfo.InvariantCulture),
                Name = game.Title,
                IsInstalled = true,
                Playtime = game.PlaytimeSeconds,
                LastActivity = Date(game.LastPlayedAt),
                Favorite = game.Favorite,
                UserScore = Score(game),
                CompletionStatus = status == null ? null : new MetadataNameProperty(status),
                Platforms = new HashSet<MetadataProperty> { platform },
            };
        }
    }
}
