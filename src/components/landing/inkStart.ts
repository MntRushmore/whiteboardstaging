/**
 * When the page's ink draws itself (v3): each drawn thing (`HandMath`, `InkMark` with a `draw` key)
 * is held at pen-down until it is well in view, then plays, once.
 *
 * `INK_START_SCRIPT` runs inline at the end of the page's server HTML, before the first paint and
 * without waiting for hydration, like the hero's REPLAY_START_SCRIPT. It never touches an element
 * React renders: it holds the drawings with a style of its own in <head>
 * (`[data-lp-draw="key"] path { paused }`) and rewrites that style as each one comes into view, so
 * hydration sees the server's HTML unchanged. No IntersectionObserver, or no script at all: nothing
 * is held and everything draws on load, as CSS alone would. A client-side navigation to the page
 * (where an inline script does not run) also simply draws on load.
 */

/** The attribute a drawn element carries; its value is the element's key. */
export const INK_DRAW_ATTR = "data-lp-draw";

/** How much of a drawing must be in view before it plays: this share of its height, or of the screen's. */
export const INK_VISIBLE = 0.4;

const HOLD_ID = "lp-ink-hold";

export const INK_START_SCRIPT =
  `(function(){if(!("IntersectionObserver" in window))return;var A="${INK_DRAW_ATTR}";` +
  `var held={},n=0,s=document.createElement("style");s.id=${JSON.stringify(HOLD_ID)};document.head.appendChild(s);` +
  `function css(){var r=[];for(var k in held)r.push('['+A+'="'+k+'"] path,['+A+'="'+k+'"] [data-lp-ink]');` +
  `s.textContent=r.length?r.join(",")+"{animation-play-state:paused!important}":""}` +
  // measured live, not from the entry: the first callback can come before the page is laid out
  `function seen(el){var b=el.getBoundingClientRect(),v=window.innerHeight,h=Math.min(b.bottom,v)-Math.max(b.top,0);return h>0&&h>=${INK_VISIBLE}*Math.min(b.height,v)}` +
  `var o=new IntersectionObserver(function(){scan()},{threshold:[0,.1,.2,.3,.4,.5,.6,.7,.8,.9,1]});` +
  // every drawing now in the page (an element React replaced is found again by its key)
  `function scan(){var els=document.querySelectorAll("["+A+"]"),c=0;for(var i=0;i<els.length;i++){var k=els[i].getAttribute(A);` +
  `if(!held[k])continue;if(seen(els[i])){delete held[k];o.unobserve(els[i]);c=1}else o.observe(els[i])}if(c)css()}` +
  `var els=document.querySelectorAll("["+A+"]");for(var j=0;j<els.length;j++){held[els[j].getAttribute(A)]=1;n++}if(!n)return;css();scan();` +
  // and again as the page settles and scrolls (fonts and pictures move things)
  `var t=0;function later(){if(!t)t=requestAnimationFrame(function(){t=0;scan()})}` +
  `window.addEventListener("load",later);window.addEventListener("scroll",later,{passive:true});window.addEventListener("resize",later)})();`;
