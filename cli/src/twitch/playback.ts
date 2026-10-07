import { queryTwitchGql, type GqlQueryOptions } from "./query.js";

/** What a playback access token is requested for. */
export type PlaybackTarget = { kind: "vod"; videoId: string } | { kind: "live"; channel: string };

const PLAYBACK_TOKEN_QUERY =
  "query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!, $platform: String!) { streamPlaybackAccessToken(channelName: $login, params: {platform: $platform, playerBackend: \"mediaplayer\", playerType: $playerType}) @include(if: $isLive) { value signature } videoPlaybackAccessToken(id: $vodID, params: {platform: $platform, playerBackend: \"mediaplayer\", playerType: $playerType}) @include(if: $isVod) { value signature } }";

/**
 * Ask Twitch for a playback access token and return the GraphQL `data` object.
 * The token sits under `videoPlaybackAccessToken` or `streamPlaybackAccessToken`
 * and is null when Twitch grants none; what that means differs between a VOD
 * and a live channel, so the caller interprets it. The request goes through
 * the shared transport, so a throttled or failing Twitch is retried like every
 * other GraphQL call and failures surface as GqlQueryError.
 */
export function queryPlaybackToken(
  target: PlaybackTarget,
  options: GqlQueryOptions = {},
): Promise<Record<string, unknown>> {
  const live = target.kind === "live";
  return queryTwitchGql(
    {
      operationName: "PlaybackAccessToken_Template",
      query: PLAYBACK_TOKEN_QUERY,
      variables: {
        isLive: live,
        login: live ? target.channel : "",
        isVod: !live,
        vodID: live ? "" : target.videoId,
        playerType: "site",
        platform: "web",
      },
    },
    options,
  );
}
