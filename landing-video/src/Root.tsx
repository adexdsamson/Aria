import React from 'react';
import { Composition } from 'remotion';
import { AriaDemo } from './AriaDemo';

// Total: 30s @ 30fps = 900 frames
// Scene breakdown:
//   0–90    (3s)  Intro — brand mark + tagline
//  90–270   (6s)  Scene 1 — The Briefing (morning brief screen)
// 270–450   (6s)  Scene 2 — The Triage   (inbox + draft reply)
// 450–630   (6s)  Scene 3 — The Calendar (week view + notice)
// 630–810   (6s)  Scene 4 — Ask Aria     (Q&A + citations)
// 810–900   (3s)  Outro — download CTA

export const Root: React.FC = () => (
  <Composition
    id="AriaDemo"
    component={AriaDemo}
    durationInFrames={900}
    fps={30}
    width={1920}
    height={1080}
    defaultProps={{}}
  />
);
