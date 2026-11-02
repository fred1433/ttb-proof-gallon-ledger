# October 2026, worked out by hand

Fictional plant DSP-KY-00000. Proof gallons (PG) to the tenth; wine gallons (WG) as recorded.
This sheet is the source of `expected.json`. It was written from the records, not from the engine's output.

## Storage (TTB F 5110.11, column b, whisky distilled at 160° and under)

| Line | Working | PG |
|---|---|---|
| 1 | Barrels at September 30: A-201 49.2, A-202 47.9, A-203 48.8, B-301 52.6, B-302 51.3, H-101 47.6, H-102 48.3 | 345.7 |
| 2 | Received in bond on TR-0457 (RC-1006): H-111 51.4, H-112 50.7, H-113 52.1, H-114 49.8 | 204.0 |
| 6 | 345.7 + 204.0 | 549.7 |
| 17 | Dump gauges: DR-1009 44.3 + 43.1 + 44.0 = 131.4; DR-1028 48.1 + 46.9 = 95.0 | 226.4 |
| 22 | Carried minus dumped: (145.9 - 131.4) + (103.9 - 95.0) = 14.5 + 8.9 | 23.4 |
| 23 | Barrels left: H-101, H-102, H-111 to H-114 = 95.9 + 204.0 | 299.9 |
| 24 | 226.4 + 23.4 + 299.9 | 549.7 |

## Processing (TTB F 5110.28)

Bottling A-1009: 61 cases x 12 x 750 mL = 549 L; x 0.264172 = 145.030428, 145.03 WG (19.582(b)); x 0.90 = 130.527, 130.5 PG.
Removal RM-1015: 40 cases = 360 L = 95.10192, 95.10 WG; x 0.90 = 85.59, 85.6 PG.
Removal RM-1020 (as corrected, 10 cases at 100 proof): 90 L = 23.77548, 23.78 WG = 23.8 PG.
Opening bottled stock H-0925: 24 cases at 100 proof = 216 L = 57.061152, 57.06 WG = 57.1 PG.

| Line | Working | Value |
|---|---|---|
| 1 | September line 25 | 0.0 |
| 2 | Same as storage line 17 | 226.4 |
| 8 | 0.0 + 226.4 | 226.4 |
| 9 | Bottled A-1009 | 130.5 |
| 24 | 131.4 dumped for A-1009 - 130.5 bottled | 0.9 |
| 25 | Lot B-1028 in processing tank 2 | 95.0 |
| 26 | 130.5 + 0.9 + 95.0 | 226.4 |
| 27 | September line 46 | 57.1 |
| 28 | Same as line 9 | 130.5 |
| 31 | 57.1 + 130.5 | 187.6 |
| 33 | 85.6 + 23.8 | 109.4 |
| 46 | A-1009 21 cases (189 L, 49.93 WG, 44.9 PG) + H-0925 14 cases (126 L, 33.29 WG, 33.3 PG) | 78.2 |
| 47 | 109.4 + 78.2 | 187.6 |
| 55 (b) | 226.4 PG dumped into processing, whole | 226 |
| 55 (d) | 145.03 WG bottled, whole | 145 |
