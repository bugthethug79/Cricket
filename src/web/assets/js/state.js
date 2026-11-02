export const S = {
  invite: null, auth: null, chatKey: null, name: '', color: 210, host_token: '', host_id: '',
  ws: null, me: null, joinedAt: 0, ice: [], forceRelay: false,
  peers: new Map(),
  local: { main: new MediaStream(), mic: null, micOn: false, cam: null, screen: null },
  left: false, errorMsg: '', audioCtx: null, pinned: null, unread: 0,
};

export function myState() {
  return {
    mic: !!S.local.mic && S.local.micOn,
    cam: !!S.local.cam,
    screen: !!S.local.screen,
    screen_stream: S.local.screen ? S.local.screen.id : '',
  };
}
