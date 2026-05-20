// app-icons.jsx — minimalist line icons in the editorial vein
// Stroke 1.5, rounded caps, sized via fontSize/em or style props

const Icon = ({ d, size = 18, stroke = 1.5, fill = 'none', style = {}, viewBox = "0 0 24 24" }) => (
  <svg width={size} height={size} viewBox={viewBox} fill={fill} stroke="currentColor"
       strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={style}>
    {typeof d === 'string' ? <path d={d} /> : d}
  </svg>
);

const I = {
  briefing:  (p) => <Icon {...p} d={<><path d="M5 4h11l3 3v13H5z"/><path d="M16 4v3h3"/><path d="M8 11h8M8 14h8M8 17h5"/></>} />,
  inbox:     (p) => <Icon {...p} d={<><path d="M3 7l9 6 9-6"/><rect x="3" y="5" width="18" height="14" rx="1"/></>} />,
  calendar:  (p) => <Icon {...p} d={<><rect x="3" y="5" width="18" height="16" rx="1"/><path d="M3 10h18M8 3v4M16 3v4"/></>} />,
  approve:   (p) => <Icon {...p} d={<><path d="M5 12l4 4 10-10"/><path d="M3 18h18" opacity="0.4"/></>} />,
  ask:       (p) => <Icon {...p} d={<><path d="M21 11.5a8 8 0 1 1-3.3-6.4"/><path d="M9 9a3 3 0 1 1 4 2.8c-1 .5-1 1.7-1 2.2M12 17v.5"/></>} />,
  meeting:   (p) => <Icon {...p} d={<><circle cx="9" cy="9" r="3"/><circle cx="17" cy="10" r="2"/><path d="M3 19c0-3 3-5 6-5s6 2 6 5M14 19c.5-2 2-3 3.5-3s2.5 1 3 3"/></>} />,
  recap:     (p) => <Icon {...p} d={<><path d="M5 4h12l3 3v13H5z"/><path d="M9 13h7M9 17h5M9 9h4"/></>} />,
  settings:  (p) => <Icon {...p} d={<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></>} />,
  onboarding:(p) => <Icon {...p} d={<><path d="M12 3v18M5 10l7-7 7 7"/></>} />,
  search:    (p) => <Icon {...p} d={<><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></>} />,
  bell:      (p) => <Icon {...p} d={<><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a2 2 0 0 0 3.4 0"/></>} />,
  chevron_r: (p) => <Icon {...p} d="m9 6 6 6-6 6" />,
  chevron_l: (p) => <Icon {...p} d="m15 6-6 6 6 6" />,
  chevron_d: (p) => <Icon {...p} d="m6 9 6 6 6-6" />,
  plus:      (p) => <Icon {...p} d="M12 5v14M5 12h14" />,
  x:         (p) => <Icon {...p} d="M6 6l12 12M18 6l-12 12" />,
  check:     (p) => <Icon {...p} d="M5 12l4 4 10-10" />,
  edit:      (p) => <Icon {...p} d={<><path d="M4 20h4l11-11-4-4L4 16z"/><path d="m14 6 4 4"/></>} />,
  send:      (p) => <Icon {...p} d="M22 2 11 13M22 2l-7 20-4-9-9-4z" />,
  arrow_r:   (p) => <Icon {...p} d="M5 12h14M13 5l7 7-7 7" />,
  arrow_dr:  (p) => <Icon {...p} d="M7 7l10 10M9 17h8v-8" />,
  cloud_off: (p) => <Icon {...p} d={<><path d="M3 3l18 18"/><path d="M9 6a5 5 0 0 1 9 3v0a4 4 0 0 1 1 7.7M7 7a4 4 0 0 0-1 7h9"/></>} />,
  cloud:     (p) => <Icon {...p} d="M18 10a5 5 0 0 0-9.6-2A4 4 0 0 0 7 16h11a4 4 0 0 0 0-6z" />,
  lock:      (p) => <Icon {...p} d={<><rect x="4" y="11" width="16" height="10" rx="1"/><path d="M8 11V7a4 4 0 1 1 8 0v4"/></>} />,
  cpu:       (p) => <Icon {...p} d={<><rect x="7" y="7" width="10" height="10" rx="1"/><path d="M12 4v3M12 17v3M4 12h3M17 12h3M9 4v3M15 4v3M9 17v3M15 17v3M4 9h3M4 15h3M17 9h3M17 15h3"/></>} />,
  globe:     (p) => <Icon {...p} d={<><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/></>} />,
  shield:    (p) => <Icon {...p} d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />,
  doc:       (p) => <Icon {...p} d={<><path d="M5 3h11l3 3v15H5z"/><path d="M16 3v3h3"/></>} />,
  download:  (p) => <Icon {...p} d={<><path d="M12 4v12M6 11l6 6 6-6"/><path d="M5 20h14"/></>} />,
  link:      (p) => <Icon {...p} d="M10 14a4 4 0 0 1 0-6l2-2a4 4 0 1 1 6 6l-1 1M14 10a4 4 0 0 1 0 6l-2 2a4 4 0 1 1-6-6l1-1" />,
  flame:     (p) => <Icon {...p} d="M12 3s5 4 5 9a5 5 0 1 1-10 0c0-2 1-3 2-4 0 0 1 2 2 1 0-3 1-5 1-6z" />,
  clock:     (p) => <Icon {...p} d={<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>} />,
  star:      (p) => <Icon {...p} d="M12 3l2.7 6.2 6.7.6-5 4.5 1.5 6.6L12 17.5 6.1 20.9 7.6 14.3l-5-4.5 6.7-.6z" />,
  command:   (p) => <Icon {...p} d="M9 9a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z" />,
  list:      (p) => <Icon {...p} d="M3 6h18M3 12h18M3 18h18" />,
  filter:    (p) => <Icon {...p} d="M3 5h18l-7 9v6l-4-2v-4z" />,
  sparkle:   (p) => <Icon {...p} d="M12 4v6M12 14v6M4 12h6M14 12h6M6 6l4 4M14 14l4 4M18 6l-4 4M10 14l-4 4" />,

  // Additions for the post-update UI
  task:      (p) => <Icon {...p} d={<><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 10h8M8 14h5"/><path d="m15.5 14 1.5 1.5 2.5-3" stroke="currentColor"/></>} />,
  chat:      (p) => <Icon {...p} d="M4 5h16v11H8l-4 4z" />,
  schedule:  (p) => <Icon {...p} d={<><rect x="3" y="5" width="18" height="16" rx="1"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="m9 15 2 2 4-4"/></>} />,
  key:       (p) => <Icon {...p} d={<><circle cx="8" cy="14" r="4"/><path d="m11 13 9-9M16 4l4 4M15 5l3 3"/></>} />,
  vault:     (p) => <Icon {...p} d={<><rect x="3" y="5" width="18" height="14" rx="1"/><circle cx="12" cy="12" r="3"/><path d="M12 4v1M12 19v1M3 9h2M3 15h2M19 9h2M19 15h2"/></>} />,
  bolt:      (p) => <Icon {...p} d="M13 3 4 14h7l-1 7 9-11h-7z" />,
  refresh:   (p) => <Icon {...p} d={<><path d="M20 7v6h-6"/><path d="M4 17v-6h6"/><path d="M19 13a7 7 0 0 1-12 4M5 11a7 7 0 0 1 12-4"/></>} />,
  snooze:    (p) => <Icon {...p} d={<><circle cx="12" cy="13" r="8"/><path d="M9 10h6l-6 6h6M5 5l3-2M19 5l-3-2"/></>} />,
  upload:    (p) => <Icon {...p} d={<><path d="M12 20V8M6 13l6-6 6 6"/><path d="M5 4h14"/></>} />,
  trash:     (p) => <Icon {...p} d={<><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></>} />,
  database:  (p) => <Icon {...p} d={<><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></>} />,
  filter2:   (p) => <Icon {...p} d="M3 5h18l-7 9v5l-4-2v-3z" />,
  pause:     (p) => <Icon {...p} d="M9 5v14M15 5v14" />,
  play:      (p) => <Icon {...p} d="M7 4l13 8-13 8z" />,
};

window.I = I;
window.AriaIcon = Icon;
