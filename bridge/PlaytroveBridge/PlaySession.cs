using System;
using System.Diagnostics;
using System.Threading.Tasks;
using Playnite.SDK;
using Playnite.SDK.Plugins;

namespace PlaytroveBridge
{
    /// <summary>Uma partida aberta pelo Playtrove, do jeito que o Playnite espera saber dela.</summary>
    public static class PlaySession
    {
        /// <summary>
        /// Pede o jogo, avisa que começou com o processo do emulador e, quando ele fecha, que terminou.
        /// Se o Playtrove recusar, mostra o motivo e termina sem começar. Devolve quando tudo acabou.
        /// </summary>
        public static Task Run(Func<int> play, Action<int> started, Action stopped, Action<string> failed, Func<int, Task> waitForExit)
        {
            int processId;
            try
            {
                processId = play();
            }
            catch (PlaytroveException error)
            {
                failed(error.Message);
                stopped();
                return Task.FromResult(true);
            }
            started(processId);
            return waitForExit(processId).ContinueWith(_ => stopped());
        }

        /// <summary>Espera o processo do emulador fechar (já fechado ou de outro usuário conta como fechado).</summary>
        public static Task WaitForExit(int processId) => Task.Run(() =>
        {
            try
            {
                using (var process = Process.GetProcessById(processId))
                {
                    process.WaitForExit();
                }
            }
            catch (Exception)
            {
                // O processo já não existe.
            }
        });
    }

    /// <summary>O Jogar dos jogos do Playtrove: quem abre o emulador e conta o tempo é o Playtrove.</summary>
    public class PlaytrovePlayController : PlayController
    {
        private readonly PlaytroveClient client;
        private readonly IPlayniteAPI api;

        public PlaytrovePlayController(Playnite.SDK.Models.Game game, PlaytroveClient client, IPlayniteAPI api) : base(game)
        {
            Name = "Playtrove";
            this.client = client;
            this.api = api;
        }

        public override void Play(PlayActionArgs args)
        {
            var gameId = long.Parse(Game.GameId, System.Globalization.CultureInfo.InvariantCulture);
            PlaySession.Run(
                () => client.Play(gameId),
                processId => InvokeOnStarted(new GameStartedEventArgs { StartedProcessId = processId }),
                // O tempo jogado fica com o Playtrove: o Playnite não soma nada.
                () => InvokeOnStopped(new GameStoppedEventArgs(0)),
                message => api.Dialogs.ShowErrorMessage(message, "Playtrove"),
                PlaySession.WaitForExit);
        }
    }
}
