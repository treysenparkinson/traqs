import WebKit

// MARK: - The Apple skin, injected
//
// This is the ONLY thing that makes the Mac app look different from the web app,
// and it lives entirely on this side of the line. The Netlify build is never
// touched: it stays the plain product, which is what the future Windows app will
// be built on. Anything Apple-specific — Liquid Glass controls, native focus
// rings, macOS type — is layered on HERE, at load time, and exists only inside
// this window.
//
// Injected as a WKUserScript at document START, so the styles are in place
// before React paints and nothing flashes un-skinned. User scripts run outside
// the page's own CSP, so the site's `style-src` policy is not in play.
//
// `!important` throughout, and it is not optional: TRAQS.jsx styles nearly
// everything with inline `style={{…}}` objects, and an inline style beats any
// stylesheet rule that isn't marked important.
enum MacNativeSkin {

    /// Tags the document so every rule below can be scoped to this app, and so
    /// the web app itself could branch on it later if it ever wants to.
    private static let marker = "traqs-mac-native"

    @MainActor
    static func userScript() -> WKUserScript {
        let js = """
        (function () {
          var root = document.documentElement;
          root.classList.add('\(marker)');
          var id = 'traqs-mac-native-skin';
          if (document.getElementById(id)) return;
          var style = document.createElement('style');
          style.id = id;
          style.textContent = `\(css)`;
          (document.head || root).appendChild(style);
        })();
        """
        return WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    /// The skin itself.
    ///
    /// Liquid Glass on the web is an IMITATION and has to be built the way the
    /// real material is: a translucent fill that samples what is behind it
    /// (`backdrop-filter`), a bright lip along the top edge where light catches,
    /// a darker band down the sides, and a soft ambient lift. A flat translucent
    /// rectangle with a border is what "glassy" CSS usually means, and it reads
    /// as a grey box.
    private static let css = """
    /* Every control in the app carries one of these. `.anim-btn` is every <Btn>
       (~96 call sites); the bare `button` catches the ~429 hand-rolled ones.
       Excluded are the elements that are buttons structurally but rows visually —
       calendar days, segmented-track pills, dialog dismissals — which the web app
       already opts out of its own button chrome. */
    .\(marker) button:not(.tq-noanim):not(.tq-pill-seg):not(.tq-cal-day),
    .\(marker) .anim-btn {
      backdrop-filter: blur(18px) saturate(180%) !important;
      -webkit-backdrop-filter: blur(18px) saturate(180%) !important;
      background: linear-gradient(
        180deg,
        rgba(255, 255, 255, 0.16) 0%,
        rgba(255, 255, 255, 0.06) 44%,
        rgba(255, 255, 255, 0.03) 100%
      ) !important;
      border: none !important;
      /* Three shadows doing three different jobs: the lit top lip, the darker
         side/bottom containment, and the ambient float. Layered in that order
         because an inset drawn after the ambient one would be washed out by it. */
      box-shadow:
        inset 0 1px 0 0 rgba(255, 255, 255, 0.38),
        inset 0 -1px 0 0 rgba(255, 255, 255, 0.10),
        inset 0 0 0 0.5px rgba(255, 255, 255, 0.16),
        0 2px 10px -2px rgba(0, 0, 0, 0.30) !important;
      transition: transform 0.16s cubic-bezier(0.2, 0.8, 0.2, 1),
                  box-shadow 0.16s ease,
                  background 0.16s ease !important;
    }

    /* The primary CTA keeps its brand colour — as a TINT through the glass rather
       than a flat gradient behind it. Losing the accent entirely would leave a
       screen of identical clear pills with no answer to "which one submits". */
    .\(marker) .anim-btn {
      background: linear-gradient(
        180deg,
        rgba(79, 172, 254, 0.42) 0%,
        rgba(30, 64, 175, 0.34) 100%
      ) !important;
      box-shadow:
        inset 0 1px 0 0 rgba(255, 255, 255, 0.42),
        inset 0 0 0 0.5px rgba(255, 255, 255, 0.20),
        0 4px 16px -4px rgba(30, 64, 175, 0.55) !important;
    }

    /* Press response: the material compresses rather than dimming. A brightness
       filter — which is what the web app does today — reads as a light being
       turned down; glass reads as being pushed. */
    .\(marker) button:not(.tq-noanim):not(.tq-pill-seg):not(.tq-cal-day):hover,
    .\(marker) .anim-btn:hover {
      transform: translateY(-0.5px) !important;
      filter: none !important;
    }
    .\(marker) button:not(.tq-noanim):not(.tq-pill-seg):not(.tq-cal-day):active,
    .\(marker) .anim-btn:active {
      transform: scale(0.975) !important;
      filter: none !important;
    }

    /* A disabled control is not glass — it is off. Dropping the blur is what
       says so; dimming alone leaves it looking pressable. */
    .\(marker) button:disabled {
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
      box-shadow: none !important;
      opacity: 0.4 !important;
      transform: none !important;
    }

    /* macOS focus ring, so keyboard navigation looks like the rest of the system
       rather than like a web page. */
    .\(marker) button:focus-visible {
      outline: 3.5px solid rgba(0, 122, 255, 0.55) !important;
      outline-offset: 2px !important;
    }

    /* Native text selection and smoother type — the two smallest things that
       stop a web view feeling like a browser tab. */
    .\(marker) ::selection { background: rgba(0, 122, 255, 0.30); }
    .\(marker) body {
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }
    """
}
