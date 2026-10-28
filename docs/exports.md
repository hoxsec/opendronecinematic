# Export formats

All exporters take the same planned mission. By default they write one waypoint per planned waypoint and let the drone app handle the curves and POI tracking. With **Match preview exactly** (densify) they instead sample the previewed path every _N_ metres and write each sample with a fixed heading and gimbal pitch, so the drone flies the same curve and camera move you previewed.

|                  | Litchi CSV                        | DJI KMZ (WPML)                                       | QGC .plan / Mission Planner .waypoints      |
| ---------------- | --------------------------------- | ---------------------------------------------------- | ------------------------------------------- |
| Status           | ✅ M1                             | ✅ M1                                                | ✅ M2                                       |
| Apps             | Litchi (Mission Hub, Android/iOS) | DJI Pilot 2, FlightHub 2 (DJI Fly with a workaround) | QGroundControl, Mission Planner             |
| Height reference | Relative to takeoff, or AGL       | Relative to takeoff                                  | Relative to home (`GLOBAL_RELATIVE_ALT`)    |
| POI heading      | Per-waypoint POI + focus          | `towardPOI`                                          | `DO_SET_ROI_LOCATION`                       |
| Smooth gimbal    | Interpolate between waypoints     | `gimbalEvenlyRotate` over each leg                   | Steps at each waypoint (`DO_MOUNT_CONTROL`) |
| Interval photos  | `photo_distinterval` per leg      | `multipleDistance` action group                      | `DO_SET_CAM_TRIGG_DIST`                     |
| Waypoint limit   | 99                                | 65 535                                               | Depends on the flight controller            |
| Import           | ✅                                | ✅ `.kmz`, `template.kml`, `waylines.wpml`           | ✅ including QGC survey items               |

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

## QGroundControl .plan and Mission Planner .waypoints

Both are MAVLink missions built from the same item list, for PX4 and ArduPilot multirotors. The `.plan` file has a PX4/ArduPilot switch (it sets `firmwareType`); the `.waypoints` file is the plain `QGC WPL 110` text that Mission Planner and most ArduPilot tools read.

- The mission starts with `NAV_TAKEOFF` to the first waypoint's height (at least 5 m), then one `NAV_WAYPOINT` per point. Heights are relative to home. Hover time goes in the waypoint's hold time (param 1).
- **Heading:** _fixed_ headings and densified points write the yaw (param 4). _Along path_ leaves it unset so the firmware points the nose along the leg.
- **POI:** waypoints that face or track a POI are preceded by `DO_SET_ROI_LOCATION`; leaving POI mode writes `DO_SET_ROI_NONE`. With an ROI the firmware aims both the nose and the gimbal.
- **Gimbal and speed:** `DO_MOUNT_CONTROL` (pitch) and `DO_CHANGE_SPEED` are written before the waypoint they belong to, whenever they change. DO commands run when the vehicle heads for the next waypoint, so the gimbal steps at each waypoint instead of easing; use densify for smooth tilts.
- **Actions:** photo → `IMAGE_START_CAPTURE` (1 image), recording → `VIDEO_START_CAPTURE` / `VIDEO_STOP_CAPTURE`, interval photos → `DO_SET_CAM_TRIGG_DIST`, written after the waypoint.
- **Finish:** _return home_ → `NAV_RETURN_TO_LAUNCH`, _land_ → `NAV_LAND` at the last waypoint, _hover_ → nothing (the vehicle loiters).
- PX4 and ArduPilot fly straight legs. The exporter warns when the mission uses smooth curves; enable densify to keep them.
- The planned home height is the takeoff's WGS84 ellipsoid height. The ground station replaces it with the real home on upload, and every item is relative to home, so this does not change the flight.

## Importing missions

**Open…** reads OpenDroneCinematic `.json` files and the formats above: Litchi `.csv`, DJI `.kmz` (or a bare `template.kml` / `waylines.wpml`), QGC `.plan` and Mission Planner `.waypoints`. The format is detected from the extension and the content. The app then samples the ground at home and under every waypoint, so heights land where they were planned.

- **Takeoff:** the file's home position when it has one (`.plan`, `.waypoints`, DJI `takeOffRefPoint`), otherwise the first waypoint.
- **Heights** keep their reference: relative to takeoff, AGL (Litchi `altitudemode=1`, DJI `realTimeFollowSurface`, MAVLink terrain frame) or absolute. Absolute sea-level heights (DJI EGM96, MAVLink AMSL) are read as WGS84 ellipsoid heights, with a warning.
- **Litchi:** a row with gimbal mode _focus POI_ becomes a waypoint that faces and tracks that POI; other rows get a fixed heading and pitch. Curve sizes above 0 switch the path to _smooth_.
- **DJI:** the drone enum picks the matching profile. Heading modes, POIs, hover, photo, recording, gimbal rotations and `multipleDistance` photos are read.
- **QGC:** survey, corridor and structure scan items are flattened into their generated waypoints. Other complex items (such as VTOL landing patterns) are skipped with a warning.
- Commands and actions without an equivalent (zoom, timed photo intervals, `DO_JUMP`, ...) are skipped and listed in the import message.

## Validating an export

1. Open the file in the target app and check the point count, the heights and the POI.
2. Run the mission in the app's simulator if it has one (DJI Pilot 2 has one for some aircraft).
3. Make the first real flight with plenty of clearance, and be ready to take over.

If something maps incorrectly, please open an issue and attach the exported file and the app or firmware version.
