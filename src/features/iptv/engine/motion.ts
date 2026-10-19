// ===================== Motion for the live-TV page (GSAP) =====================
// Small, quick animations that say what just happened: the list re-sorted, a channel was switched
// to, a favourite was set. Everything here is skipped for viewers who ask for reduced motion, and
// every tween clears what it set, so the layout is exactly as it was once it ends.
import gsap from 'gsap';

export { gsap };

export function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The page comes in: the channel panel from the side, the player from below. */
export function introPage(root: HTMLElement) {
  if (reducedMotion()) return () => {};
  const ctx = gsap.context(() => {
    gsap.from('#channelPanel', { x: -28, opacity: 0, duration: 0.5, ease: 'power3.out', clearProps: 'transform,opacity' });
    // opacity only: the player's place on the page is measured (and relied on) from the first frame
    gsap.from('#playerColumn', { opacity: 0, duration: 0.55, delay: 0.08, ease: 'power2.out', clearProps: 'opacity' });
  }, root);
  return () => ctx.revert();
}

/** The rows on screen cascade in after a new filter or sort order. */
export function cascadeRows(box: HTMLElement) {
  if (reducedMotion()) return;
  const rows = [...box.querySelectorAll<HTMLElement>('.channel-row')].slice(0, 24);
  if (!rows.length) return;
  gsap.killTweensOf(rows);
  gsap.from(rows, { x: -14, opacity: 0, duration: 0.32, ease: 'power2.out', stagger: 0.022, clearProps: 'transform,opacity' });
}

/** The marker on the playing row grows in. */
export function markSelected(marker: Element | null) {
  if (!marker || reducedMotion()) return;
  gsap.fromTo(marker, { scaleY: 0 }, { scaleY: 1, duration: 0.35, ease: 'back.out(2.5)', clearProps: 'transform' });
}

/** A star that was just set (or cleared) pops. */
export function popStar(star: Element | null, on: boolean) {
  if (!star || reducedMotion()) return;
  gsap.fromTo(star,
    { scale: on ? 1.7 : 0.6, rotate: on ? -40 : 20 },
    { scale: 1, rotate: 0, duration: on ? 0.5 : 0.3, ease: on ? 'back.out(3)' : 'power2.out', clearProps: 'transform' });
}

/** The filter drawer's controls drop in one after another. */
export function revealFilters(panel: HTMLElement | null) {
  if (!panel || reducedMotion()) return;
  const items = panel.querySelectorAll(':scope > .grid > *, :scope > :not(.grid)');
  gsap.from(items, { y: -8, opacity: 0, duration: 0.25, ease: 'power2.out', stagger: 0.035, clearProps: 'transform,opacity' });
}

/**
 * Switching channel: the picture slides in from the side it came from, and a "now playing" card
 * shows the channel for a moment. `direction` is -1 for previous, +1 for next, 0 for a pick from the list.
 */
export function switchChannel(video: HTMLElement | null, card: HTMLElement | null, direction: number) {
  if (reducedMotion()) {
    if (card) gsap.set(card, { autoAlpha: 0 });
    return () => {};
  }
  const tl = gsap.timeline();
  if (video) tl.fromTo(video, { xPercent: direction * 8, opacity: 0.15, scale: direction ? 1 : 0.97 }, { xPercent: 0, opacity: 1, scale: 1, duration: 0.45, ease: 'power3.out', clearProps: 'transform,opacity' }, 0);
  if (card) {
    tl.fromTo(card, { autoAlpha: 0, x: -30 }, { autoAlpha: 1, x: 0, duration: 0.4, ease: 'power3.out' }, 0.1)
      .fromTo(card.querySelectorAll('[data-anim]'), { y: 8, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, stagger: 0.06, ease: 'power2.out' }, 0.2)
      .to(card, { autoAlpha: 0, x: -16, duration: 0.4, ease: 'power2.in' }, '+=2.4');
  }
  return () => tl.kill();
}

/** A little press feedback for a button. */
export function nudge(el: Element | null, direction: number) {
  if (!el || reducedMotion()) return;
  gsap.fromTo(el, { x: direction * 4 }, { x: 0, duration: 0.35, ease: 'elastic.out(1, 0.4)', clearProps: 'transform' });
}
