# Hidden VOD limits

The resolver follows the path calculation used by
[`twitch-dlp`](https://github.com/DmitryScaletta/twitch-dlp). A hidden VOD cannot
be recovered when Twitch no longer stores its media fragments. Common reasons
include:

- The retention period has ended.
- The broadcaster deleted the VOD manually.
- Past broadcasts were disabled for the channel.
- The channel is suspended.
- The recorded start time is wrong beyond what the search window covers.

Tracker sites may also block automated requests. When exact sources are
unavailable, the resolver falls back to a bounded second-by-second search
around the provided timestamp (`--timestamp-window`, default 120). A canonical
`video:...` target therefore works with an approximate start time close to the
real one. The resolver probes Twitch's CloudFront hostnames. It also knows three
Twitch-owned aliases of the same distribution (`vod-secure`, `vod-metro` and
`vod-pop-secure`), but it uses them only when no CloudFront hostname answers
at all, which means the network blocks CloudFront rather than the VOD being
absent. Probing both pools together would repeat every request. Probe results are memoized per media URL for ten minutes within the
same process, so `list --probe` and repeated programmatic calls do not re-ask
the same missing paths; transient CDN failures are never cached.
