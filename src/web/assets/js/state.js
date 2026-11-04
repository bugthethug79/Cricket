export const S = {
  invite: null, auth: null, name: '', color: 210, host_token: '', host_id: '',
  ws: null, me: null, joinedAt: 0, ice: [], forceRelay: false,
  peers: new Map(), cameras: [],
  local: { main: new MediaStream(), mic: null, micOn: false, cam: null, screen: null, deafened: false, hostMuted: false, hostDeafened: false, facing: 'user', camId: '' },
  left: false, errorMsg: '', audioCtx: null, pinned: null, unread: 0,
};

export function myState() {
  return {
    mic: !!S.local.mic && S.local.micOn,
    cam: !!S.local.cam,
    screen: !!S.local.screen,
    screen_stream: S.local.screen ? S.local.screen.id : '',
    deafened: !!S.local.deafened,
    host_muted: !!S.local.hostMuted,
    host_deafened: !!S.local.hostDeafened,
  };
}
