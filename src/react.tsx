"use client";

import { useEffect } from "react";
import { type BeaconOptions, init } from "./index";

export { type Beacon, type BeaconOptions, type Identity, track } from "./index";

/**
 * The beacon as a component: render it once in your root layout. Starts on
 * mount, reports client-side navigations on its own, and stops on unmount.
 * Renders nothing.
 *
 *   <BalladBeacon site={process.env.NEXT_PUBLIC_BALLAD_SITE_TOKEN} />
 *
 * If your app lives on another origin, pass `handoff={["app.example.com"]}`
 * so the touch follows the visitor there (and mount the beacon there too).
 */
export function BalladBeacon(
  props: Omit<BeaconOptions, "site"> & { site: string | undefined },
) {
  const { site, endpoint, trackNavigation, respectGpc, trackAttributes } =
    props;
  // A list prop would re-init on every render; key the effect on its text.
  const handoffKey = props.handoff?.join(",") ?? "";
  useEffect(() => {
    if (!site) return;
    const beacon = init({
      site,
      ...(endpoint !== undefined ? { endpoint } : {}),
      ...(trackNavigation !== undefined ? { trackNavigation } : {}),
      ...(respectGpc !== undefined ? { respectGpc } : {}),
      ...(trackAttributes !== undefined ? { trackAttributes } : {}),
      ...(handoffKey ? { handoff: handoffKey.split(",") } : {}),
    });
    return () => beacon?.destroy();
  }, [site, endpoint, trackNavigation, respectGpc, trackAttributes, handoffKey]);
  return null;
}
