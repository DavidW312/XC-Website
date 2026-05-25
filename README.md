# XC Team Dashboard

A static website for cross country summer mileage and meet results, powered by Google Sheets.

### Required tabs

| Tab | Purpose |
|-----|---------|
| Any name containing **Week** (e.g. `Week 1`, `Summer Week 2`) | Weekly mileage |
| **Race_Results** | Meet results |

### Week tab columns

| Col | Field |
|-----|-------|
| A | Last name |
| B | First name |
| C–H | Mon–Sat (miles, or `A` / `XA` / `INJ` for absences) |
| I | Weekly total |
| J | Grade (number: `9`, `10`, `11`, or `12`) |

Enter grade as a plain number in column J (not "11th" or "Junior"). Leave blank if unknown; those athletes sort last and show **—** on the leaderboard.

### Race_Results columns

One row per athlete per meet. Everyone at a meet runs the same distance; the distance label can differ between meets.

| Col | Field | Example |
|-----|-------|---------|
| A | Athlete name | Jane Doe |
| B | Meet name | Husky Invite |
| C | Date (M/D/YY) | 9/14/26 |
| D | Time | 19:42 |
| E | Distance label | 3 Mile |

## Local preview

Open [index.html](index.html) in a browser, or use a simple static server.

## Future additions

PR tracking and athlete progression charts can be added later without changing the mileage workflow.
