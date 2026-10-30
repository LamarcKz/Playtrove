using System;
using System.Runtime.Serialization;
using Playnite.SDK.Models;

namespace PlaytroveBridge
{
    /// <summary>O que o Aniki mudou num jogo do Playtrove: só favorito, status e nota voltam.</summary>
    [DataContract]
    public class GameChange
    {
        [DataMember(Name = "id")] public long Id { get; set; }
        [DataMember(Name = "favorite")] public bool Favorite { get; set; }
        /// <summary>Só vai quando o status mudou; senão, o do Playtrove fica (ex.: "Fazendo 100%").</summary>
        [DataMember(Name = "statusPreset")] public string StatusPreset { get; set; }
        [DataMember(Name = "rating")] public int? Rating { get; set; }

        public static bool Changed(Game before, Game after) =>
            before.Favorite != after.Favorite || before.CompletionStatusId != after.CompletionStatusId || before.UserScore != after.UserScore;

        /// <summary>A nota do Playnite (0 a 100) na do Playtrove (meia a cinco estrelas, guardadas de 1 a 10).</summary>
        public static int? ToRating(int? score)
        {
            if (!score.HasValue || score.Value <= 0)
            {
                return null;
            }
            return Math.Max(1, Math.Min(10, (int)Math.Round(score.Value / 10.0, MidpointRounding.AwayFromZero)));
        }

        /// <summary>O status do Playnite no status padrão do Playtrove que mais se parece com ele.</summary>
        public static string Preset(string statusName)
        {
            switch (statusName)
            {
                case "Plan to Play": return "planToPlay";
                case "On Hold": return "onHold";
                case "Abandoned": return "abandoned";
                case "Playing": return "playing";
                case "Beaten": return "beaten";
                case "Completed": return "complete100";
                default: return null;
            }
        }
    }
}
