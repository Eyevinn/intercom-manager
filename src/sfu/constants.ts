// Normalized payload type numbers that both the SMB allocate response and
// the SDP offer/answer are rewritten to use. Picked to match whip-mpegts's
// native H264 PT (96) so forwarder-mode receivers see a consistent PT
// regardless of source. H264 and VP8 share the same main PT — they are
// mutually exclusive in the negotiated codec.
export const NORMALIZED_VIDEO_PT_MAIN = 96;
export const NORMALIZED_VIDEO_PT_RTX = 97;
