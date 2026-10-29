/**
 * PostgREST `or` filter that keeps usable rows only. Facebook (the one targetToken adapter)
 * saves a user-keyed row before the Page pick; until `platform_data.target` is set it is not usable.
 */
export const PICKED_OR =
  "platform.neq.facebook,platform_data->target.not.is.null";
