# LocalFirst design system

The source of truth is `tokens.css`. LocalFirst uses a cool slate workspace, white surfaces and an indigo accent (#4F46E5, hover #4338CA), with semantic dark-mode equivalents. Inter is bundled locally; document typography remains independently configurable.

Use 4px/8px spacing, 8?12px surface radii, quiet borders and shadows, Lucide icons and 150?250ms transitions. Respect reduced motion and visible keyboard focus. Use semantic utilities such as bg-paper, text-ink, text-ink-muted, border-line and bg-accent. Shared UI primitives own button, modal, menu, tooltip and status behavior.

The workspace sidebar uses a 248px expanded width and 72px icon rail. Mobile navigation is an accessible drawer. Editor chrome and document canvases are separate: a dark interface does not invert document content or exported files. Saved locally, peer connected and replica acknowledged are distinct states.

See [interface and compatibility notes](../../../docs/LOCALFIRST-MODERNIZATION.md).
