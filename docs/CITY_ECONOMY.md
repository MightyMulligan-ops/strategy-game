# Iberian city economy

Issue #110 uses the three city anchors already present in the Europe map's
geographic data. The fixed Mercator projection produces the mask coordinates
below. Gameplay coordinates use the existing nearest-integer order grid,
without a search for nearby land. Both points for each city are on land in
the pinned Natural Earth surface mask.

| City | Longitude | Latitude | Mask coordinates | Gameplay coordinates | Starting owner |
| --- | ---: | ---: | --- | --- | --- |
| Madrid | −3.685298 | 40.401972 | (236830, 681587) | (368, 463) | First player by stable player ID |
| Andorra la Vella | 1.516486 | 42.500001 | (294628, 650481) | (946, 152) | Second player by stable player ID |
| Bilbao | −2.929987 | 43.249982 | (245222, 639110) | (452, 38) | Neutral |

Other geographic labels remain display features. Historical matches retain
their original scenario.

## Runtime and turn flow

The new creation pin is `iberian-cities-v1`. Its balance has a versioned
price, income and capacity policy and validates starting credits as an integer
from 0 to 1,000,000,000. This bound leaves headroom for safe cumulative income.
The world archive remains the immutable base geometry. The city runtime's
genesis places the starting formations at the real city points and records
the city as each unit's permanent recruitment source.

The pure planning functions deduct and refund credits and validate recruitment,
commander selection and dispatch. Settlement consumes **all** ownership changes
in chronological order. A city appearing anywhere in that list cancels its
pending recruitment even if the final owner matches the initial owner. Income
uses final ownership only.

A movement leg ending at an undefended city point claims it. Mere transit
does not claim it. The city resolver processes hostile contacts in time order.
Arrivals at the same encounter moment can fight together. After the battle
resolves, its survivors are stationary for any later encounter. A victorious
recipient garrisons the city, and arrivals can capture it again that turn.
A field formation that enters an owned city joins the garrison there and its
remaining route ends. To leave, select troops and a Lieutenant and place a
dispatch order on a future planning map. Only that selection leaves the city.
Stored unit IDs, wounds and original city survive a split or consolidation.

The production lobby pins the city configuration at creation. The fixed
opening credit balance defaults to 2,000, and only this host setting is
configurable. The archive remains a terrain reference and the world endpoint
omits its synthetic camp markers in this cohort. The own planning endpoint
includes the real city points and own/neutral markers, private available
credits, private recruitment and dispatch queues, and owned garrison details.
It uses the existing session, Origin, CSRF and participant checks.

The revision lock serializes purchases, refunds, orders and Ready. The server
replays immutable revision commands and checks the materialized city plan
against each revision. At closure, the frozen input includes both city plans.
The resolver writes the captures, recruitments/refunds/income, next snapshot
and fresh turn in the existing atomic resolution transaction. Advancing or
retrying never performs a separate charge or income write. The migration adds
a nullable city-plan column and a city revision kind. The new guard validates
city revision ownership, charge/refund arithmetic, deadline/revision windows,
and the atomic artifact bundle. Existing runtimes retain their own guards.

The same-turn recapture fixture executes two battles and then passes the
complete ownership log into settlement. It proves the economic consequence
of recapture. It uses substituted formations and positions to make the
sequence deterministic. It is separate from the PostgreSQL start and
restart fixtures and the mocked browser tests.

## Isolated two-player acceptance runbook

Use a separately prepared disposable environment with the reviewed migration and
two test identities. Record the source SHA and database isolation evidence
before starting. Keep the home database outside the test. PostgreSQL CI can
verify committed migrations and integration assertions, while a live browser
session can verify the map and interaction sequence.

1. Create a two-seat lobby with the default treasury. Join as a different account
   in a second browser session. Ready both guests and start through the host.
   Check Madrid and Andorra la Vella spawn on land and Bilbao begins neutral.
2. Select Madrid and queue two Infantry and one Lieutenant. Confirm the host's
   treasury drops by 400 and entries show prices and Turn 2. In the other
   browser, verify its treasury and queue reveal none of the host's purchases.
   Cancel the Infantry, verify the 200 refund, then buy them again.
3. Mark the first player Ready. Verify the panel locks and stale commands are
   rejected by the server. Clear Ready before closure and verify edits reopen.
   Ready both again. Observe Turn 2, the three completed recruits in Madrid,
   capital income of 400 per capital and the own-turn reports. Reload both
   browsers and check the same stored result.
4. Pick one Lieutenant and one or more Infantry from Madrid and drag to a legal
   land destination. Verify dispatch preserves identities, HP and Madrid
   provenance, leaves unselected units in the garrison, and resolves at closure.
   An attempted departure with both Lieutenants must fail.
5. Use a deterministic integration fixture for same-turn capture and recapture,
   concurrent spending, duplicate commands and a forced transaction rollback.
   Record actual outcomes separately from browser observations. Confirm each
   fresh CI PostgreSQL service and its network are removed after the job.
