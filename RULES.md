# Ludomania rules (Danish Ludo)

## Players and board
- 2-4 players, 4 tokens each, all starting in the yard.
- 52-square circular track, clockwise. Each colour has a coloured start globe and a finish column leading to the centre.

## The die
Faces: **1, 2, Star, 4, Globus, 6**.

| Face | Effect |
|------|--------|
| 1, 2, 4, 6 | Move one token that many squares. No extra roll. |
| Globus | Choose one: bring a token out of the yard onto your start globe, or move a token on the track to the next globe ahead of it. Either way, roll again. |
| Star | Move one token on the main track to the next star ahead of it. No extra roll. |

If no legal move exists, the turn is skipped.

**Yard re-rolls:** if all of a player's unfinished tokens are in the yard (all four, or the rest are already home), they get up to 3 rolls per turn to throw a globus. Rolling a globus brings a token out and gives the usual extra roll, and the re-rolls are no longer relevant. If none of the 3 rolls is a globus, the turn passes.

## Stars
- Located 5 squares after each colour's start square, and on the last track square before each colour's finish column.
- Tokens in the yard or in their finish column can't use a star roll.
- Landing on a star with a normal roll (1, 2, 4 or 6) carries the token on to the next star ahead. This does not happen after a star or globus move, and the token stays put if no star is left ahead (the last star before the finish column). Captures are decided at the star the token ends on.

## Globes
- Each colour's start square is a globe, and there is another globe 5 squares before each start square (8 in total).

## Captures
- Landing alone on a square with one opponent token sends that token back to the yard.
- Two or more tokens of the same colour on a square defend it. If you land on a defended square, your own token goes back to the yard (stars included).
- Defending tokens don't block movement. Anyone may pass.
- Globes protect any token on them from capture. If you land on a globe holding an opponent's token (for example a forced move), **your** token goes back to the yard.
- The exception is a token coming out of the yard onto its own start globe, which captures any opponent token on it.

## Finishing
- An exact roll is needed to enter the centre. An overshoot bounces back: with 2 needed and a 6 rolled, the token moves 2 in and the remaining 4 back.
- First player with all 4 tokens home wins.
- Captures and reaching home do not give extra rolls.

## Game settings
The host chooses settings in the lobby before the game starts, and the other players can see them. They are defined in `src/settings.js`, and the lobby draws its controls from that list.
- **Power-ups** (on/off), **spawn rate** (1-10) and **most on the board at once** (1-8). The settings are saved and sent with the game, but the power-ups themselves are not built yet.

## Disconnects
- A player who loses connection (or reloads the page) can rejoin their seat within 60 seconds. The game waits for them if it is their turn.
- After 60 seconds a bot plays that seat for the rest of the game, and the player can no longer rejoin. Bots also fill seats when the host adds them in the lobby, so a game can be played solo (1 human plus up to 3 bots). A bot scores each legal move: it values captures, leaving the yard, reaching home, safe globes and escaping opponents in range, and avoids landing on defended squares.

## Open questions
- None at the moment.
