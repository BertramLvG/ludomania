# LudoMania — Design Spec

Visual spec for restyling the LudoMania game. **Keep existing game logic** — this changes how things look, not how they work.

The working reference is `ludomania-reference.html` (plain HTML/CSS/JS, open it in a browser). When this doc and the reference disagree, the reference wins.

---

## 1. Principles

- **Modern, soft, tactile.** Rounded tiles with a small "bottom lip" shadow (`inset 0 -3px 0`) so pieces and tiles feel like physical game pieces.
- **Classic Ludo colors**: red, green, yellow, blue. Never swap or replace them.
- **Night mode is the default.** The app always starts in night mode; the Day/Night slider switches for the session.
- **No gradients, no emoji.** Icons are simple stroke SVGs.

---

## 2. Color tokens

Implement as CSS custom properties on `:root` / `[data-theme="night"]` and override in `[data-theme="day"]` (or the equivalent in your theming system). Every color in the UI must come from a token.

### Player colors

| Token | Night (default) | Day |
|---|---|---|
| `--red` | `#F0504C` | `#E8433F` |
| `--green` | `#33B86A` | `#2BA55D` |
| `--yellow` | `#F8C630` | `#F6BE1A` |
| `--blue` | `#3B7CF0` | `#2C6FE6` |
| `--red-tint` (active player row) | `rgba(240,80,76,0.16)` | `#FDECEB` |
| `--green-tint` | `rgba(51,184,106,0.16)` | `#E6F5EC` |
| `--yellow-tint` | `rgba(248,198,48,0.14)` | `#FEF6DC` |
| `--blue-tint` | `rgba(59,124,240,0.18)` | `#E7EFFD` |

**Roll-button fills (both themes):** these are darker so text stays readable.

| Player | Button bg | Button text |
|---|---|---|
| Red | `#C62F2B` | `#FFFFFF` |
| Green | `#1D7F45` | `#FFFFFF` |
| Yellow | `#F6BE1A` | `#1B1F2E` (dark text on yellow, never white) |
| Blue | `#1F5BC2` | `#FFFFFF` |

### Surfaces & text

| Token | Night (default) | Day | Used for |
|---|---|---|---|
| `--page` | `#0D1019` | `#F4F5F8` | Page background |
| `--text` | `#EEF0F6` | `#1B1F2E` | Primary text |
| `--muted` | `#A3AAC2` | `#5A6178` | Secondary text, labels |
| `--panel` | `#181C2B` | `#FFFFFF` | Cards, nav buttons, inputs |
| `--line` | `#2A3047` | `#E3E6ED` | Borders, dice edge |
| `--frame` | `#1F2438` | `#1E2335` | Board frame (dark in both modes) |
| `--cell` | `#30375A` | `#FFFFFF` | Plain track tiles |
| `--star` | `#5B6488` | `#D5D9E3` | ★ icon on safe tiles |
| `--home-inner` | `#161A2A` | `#FFFFFF` | Inner panel of each base |
| `--slot` | `#242A44` | `#EEF0F4` | Token slots in bases |
| `--center` | `#161A2A` | `#FFFFFF` | Diamond in the board center |
| `--pip` | `#EEF0F6` | `#1B1F2E` | Dice pips |
| `--dice-bg` | `#232942` | `#FFFFFF` | Dice face |
| `--dot` | `#3A4162` | `#D5D9E3` | "Tokens home" dots (empty) |
| `--send-bg` / `--send-ink` | `#EEF0F6` / `#0D1019` | `#1E2335` / `#FFFFFF` | Chat send button |
| `--track` | `#232942` | `#DDE1EA` | Theme switch track |
| `--track-icon` | `#6F789C` | `#8A91A8` | Sun/moon icons in track |
| `--knob` | `#3A4270` | `#FFFFFF` | Theme switch knob |
| `--token-drop` | `#121524` | `#141828` | Drop shadow under tokens on the board |

### Shadows

| Token | Night | Day |
|---|---|---|
| `--panel-shadow` | `inset 0 -4px 0 rgba(0,0,0,0.35)` | `inset 0 -4px 0 rgba(27,31,46,0.07)` |
| `--cell-shadow` | `inset 0 -3px 0 rgba(0,0,0,0.32)` | `inset 0 -3px 0 rgba(27,31,46,0.10)` |
| `--frame-shadow` | `inset 0 -8px 0 rgba(0,0,0,0.4), 0 0 0 1px #2A3047, 0 24px 60px rgba(0,0,0,0.55)` | `inset 0 -8px 0 rgba(0,0,0,0.25), 0 20px 50px rgba(30,35,53,0.25)` |

Colored tiles (lanes, start squares) use `inset 0 -3px 0 rgba(0,0,0,0.18)` in both themes.

---

## 3. Typography

- **Font:** [Bricolage Grotesque](https://fonts.google.com/specimen/Bricolage+Grotesque) (weights 400, 600, 800). Fallback: `system-ui, sans-serif`.
- Wordmark "LudoMania": 800, 34px, letter-spacing -1px, followed by four 10×10px color squares (radius 3px) in red/green/yellow/blue order.
- Current player name: 800, 26px, letter-spacing -0.5px.
- Eyebrow labels ("NOW PLAYING"): 600, 13px, uppercase, letter-spacing 1px, `--muted`.
- Body / player names: 600, 16px. Sub-lines: 400, 13px, `--muted`.
- Buttons: 800, 19px (Roll), 600, 15px (nav).

---

## 4. Shape & spacing

| Token | Value | Notes |
|---|---|---|
| `--cell-radius` | `9px` | The main "softness" lever; everything below derives from it |
| Base (home yard) radius | `cell × 3 + 4px` (31px) | |
| Base inner radius | `cell × 2 + 4px` (22px) | |
| Center radius | `cell + 4px` (13px) | |
| Board gap between tiles | `4px` | |
| Board frame | radius 40px, padding 20px | |
| Cards | radius 28px | Turn card padding 22px; player list padding 10px |
| Player rows | radius 20px, padding 12px | |
| Nav buttons | height 44px, radius 14px | |
| Roll button | height 56px, radius 18px | |
| Dice | 112×112px, radius 28px, padding 20px | 3×3 pip grid, gap 7px |
| Inputs / send | height 48px, radius 16px | |

Minimum touch target: 44px.

---

## 5. Board geometry (15 × 15 grid)

Coordinates are **0-indexed `(row, col)`**.

```
Corner bases (6×6):  Red = top-left, Green = top-right, Yellow = bottom-right, Blue = bottom-left
Turn order:          red → green → yellow → blue (clockwise)
Track:               every cell where row ∈ 6..8 OR col ∈ 6..8, excluding the 3×3 center (6..8, 6..8)
Center:              rows 6–8 × cols 6–8 → four triangles pointing inward, each on its player's side
                     (red = left, green = top, yellow = right, blue = bottom) + small rotated diamond in --center
```

| Feature | Red | Green | Yellow | Blue |
|---|---|---|---|---|
| Start square (filled with player color) | (6, 1) | (1, 8) | (8, 13) | (13, 6) |
| Home column (filled with player color) | row 7, cols 1–5 | col 7, rows 1–5 | row 7, cols 9–13 | col 7, rows 9–13 |

**Safe squares (★):** (8, 2), (2, 6), (6, 12), (12, 8). Plain tile background with a filled star icon in `--star`, 60% of the tile size.

### Bases
- Outer block: player color, padding 3.4%, base radius, `inset 0 -6px 0 rgba(0,0,0,0.16)`.
- Inner panel: `--home-inner`, padding 13%, 2×2 grid with 12% gap, `inset 0 4px 0 rgba(0,0,0,0.10)`.
- Slots: square, radius 30%, `--slot`. A token waiting at base sits in a slot at 70% size. An empty slot means that token is out on the board.

### Tokens
- Circle in player color.
- Shadow: `inset 0 0 0 4px rgba(255,255,255,0.55)` (white ring) + `inset 0 -4px 0 rgba(0,0,0,0.2)` (bottom lip).
- On the board: 78% of a tile, plus an outer drop `0 4px 0 var(--token-drop)`.
- Positioning on the board: `left = col / 15 × 100%`, `top = row / 15 × 100%`, size `100% / 15`.

---

## 6. Components

### Header
Wordmark left, nav right (wraps on narrow screens): **Day/Night switch**, "Rules", "Leave game".

### Day/Night switch
- A `<button role="switch" aria-checked="true|false" aria-label="Night mode">`. `true` = night.
- Text label before the track: "Night" / "Day" in `--muted`, 600 14px.
- Track: 72×38px pill, `--track`, `inset 0 3px 0 rgba(0,0,0,0.12)`. Sun icon on the left, moon on the right (14px, stroke `--track-icon`).
- Knob: 30px circle, 4px inset, `--knob`. Shows a filled moon (`#C9D3FF`) in night, a yellow sun (`#F6BE1A` / stroke `#E0A300`) in day.
- Night: knob at the right (`translateX(34px)`). Day: knob at the left.
- Knob motion: `transform 0.35s cubic-bezier(0.34, 1.4, 0.64, 1)`, a slight springy overshoot.
- Theme colors cross-fade: `background-color / color 0.35s ease` on page, cards, tiles and frame.
- **Always initialise to night** on load. (Persisting the choice is optional and not decided yet.)

### Turn card
"NOW PLAYING" eyebrow + current player name + 40px color swatch. Below it, the dice next to the Roll button and a status line (`aria-live="polite"`), e.g. "Player 2 rolled 4" / "Player 1 rolled 6 — go again!".

### Dice
3×3 grid of pips; pip indices per value: 1→[4], 2→[0,8], 3→[0,4,8], 4→[0,2,6,8], 5→[0,2,4,6,8], 6→[0,2,3,5,6,8]. Short wobble animation on roll (0.4s). Expose the value via `aria-label="Dice showing N"`.

### Roll button
Fill and text from the **current player's** button tokens (table above). Bottom lip `inset 0 -5px 0 rgba(0,0,0,0.2)`; pressed state moves down 2px with a smaller lip.

### Player list
One card, rows per player: 40px numbered badge in player color, name, sub-line (e.g. "3 in base · 1 on board"), and 4 small dots for tokens that reached home. The active player's row gets that player's `-tint` background.

### Chat
Text input (visible label for screen readers) + square send button with an arrow icon.

---

## 7. Layout & responsiveness

- Page max-width 1160px, padding 28px 24px 40px, 24px gaps.
- Main row is `flex-wrap: wrap`: board (`flex: 1 1 560px; max-width: 700px`) + side panel (`flex: 1 1 300px`). On narrow screens the side panel stacks below the board.
- The board is always square (`aspect-ratio: 1`) and fluid; tiles are fractional grid tracks.

## 8. Accessibility

- Text contrast ≥ 4.5:1 (that's why Roll buttons use the darker `-btn` fills and yellow uses dark text).
- Real `<button>`, `<a>`, `<input>` + `<label>`; icon-only buttons have `aria-label`.
- Decorative SVGs get `aria-hidden="true"`.
- Respect `prefers-reduced-motion`: disable transitions and the dice wobble.
- Visible focus ring on the switch and buttons.
