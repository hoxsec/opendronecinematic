# Export formats

All exporters take the same planned mission. By default they write one waypoint per planned waypoint and let the drone app handle the curves and POI tracking. With **Match preview exactly** (densify) they instead sample the previewed path every _N_ metres and write each sample with a fixed heading and gimbal pitch, so the drone flies the same curve and camera move you previewed.

|                  | Litchi CSV                        | DJI KMZ (WPML)                                       | QGC .plan                       |
| ---------------- | --------------------------------- | ---------------------------------------------------- | ------------------------------- |
| Status           | ✅ M1                             | ✅ M1                                                | 🔜 M2                           |
| Apps             | Litchi (Mission Hub, Android/iOS) | DJI Pilot 2, FlightHub 2 (DJI Fly with a workaround) | QGroundControl, Mission Planner |
| Height reference | Relative to takeoff, or AGL       | Relative to takeoff                                  | —                               |
| POI heading      | Per-waypoint POI + focus          | `towardPOI`                                          | —                               |
| Smooth gimbal    | Interpolate between waypoints     | `gimbalEvenlyRotate` over each leg                   | —                               |
| Waypoint limit   | 99                                | 65 535                                               | —                               |

## Litchi CSV

- Import it in [Mission Hub](https://flylitchi.com/hub) with **Import → CSV**. Set the mission **heading mode to Custom** so that each waypoint's heading column is used.
- `gimbalmode` is `1` (focus POI) when the waypoint's gimbal tracks a POI, otherwise `2` (interpolate).
- Curve sizes are 40% of the shorter neighbouring leg when the path mode is _Smooth_. Litchi's curves are not the same spline as the preview, so use densify when the exact line matters, keeping under 99 points.
- Actions: hover becomes _stay for_ in ms, plus _take photo_, _start recording_ and _stop recording_.

## DJI WPML / KMZ

The archive contains `wpmz/template.kml` and `wpmz/waylines.wpml` (WPML namespace 1.0.6). Heights are always written relative to the start point, using `executeHeightMode=relativeToStartPoint`.

- **Enterprise (M30, M3E, M350):** import directly in DJI Pilot 2 or FlightHub 2. The drone and payload enum values for these profiles come from the DJI Cloud API documentation.
- **Consumer (Mini 4 Pro, Air 3, Mavic 3):** DJI Fly has no KMZ import. The community workaround is to create a waypoint mission in DJI Fly, then replace its KMZ in the app's waypoint folder on the controller with the exported file (same name). The Mini 4 Pro enum value is community-sourced and **unverified**, and the Air 3 and Mavic 3 have no known values. The exporter warns about both. Please contribute verified values from a DJI Fly–created KMZ.
- Heading modes map as follows: _along path_ → `followWayline`, _face POI_ → `towardPOI`, _fixed_ and densified points → `smoothTransition` with the angle.
- The gimbal is set absolutely at the first waypoint, then each leg has a `betweenAdjacentPoints` group with `gimbalEvenlyRotate` toward the next pitch.

## Validating an export

1. Open the file in the target app and check the point count, the heights and the POI.
2. Run the mission in the app's simulator if it has one (DJI Pilot 2 has one for some aircraft).
3. Make the first real flight with plenty of clearance, and be ready to take over.

If something maps incorrectly, please open an issue and attach the exported file and the app or firmware version.
