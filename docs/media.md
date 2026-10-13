# Media Sources

Images are shipped locally so viewing the app does not require requests to an image CDN. Guest names and matching scores in the sample workspace are fictional and simulated; the stock and generated portraits do not represent customers, and these images are not recognition benchmarks.

| Asset | Source |
| --- | --- |
| `public/images/sample-ava.jpg` | Existing sample portrait: https://images.unsplash.com/photo-1544005313-94ddf0286df2 |
| `public/images/sample-maya.jpg` | Existing sample portrait: https://images.unsplash.com/photo-1494790108377-be9c29b29330 |
| `public/images/sample-noah-reception.jpg` | Fictional sample portrait generated with the built-in ImageGen tool; not a real guest |
| `public/images/sample-noah-garden.jpg` | Generated fictional group-photo variation of the Noah reference; a simulated workflow example, not a matching benchmark |
| `public/images/review-workspace.jpg` | Screenshot of the actual local review screen with simulated sample data |
| `docs/screenshots/guest-gallery.jpg` | Screenshot of the actual `/demo/gallery` page using the fictional group-photo example; not a customer gallery |
| `public/images/event-hero.jpg` | New illustrative editorial image generated with the built-in ImageGen tool; not a real customer event |

The hero prompt requested a landscape editorial photograph of three adult friends at a private garden reception, with clear faces, naturally lit guests on the center/right, quiet green foliage on the left for headline copy, realistic skin detail, and no text, logo or watermark. It specifically excluded faceless silhouettes, computer/handshake stock imagery, glowing effects, collage and giant cropped-face framing. The generated PNG remains in the Codex image library; the project uses a compressed JPEG copy.

The Noah portrait prompt requested a fictional adult man with short dark hair, a charcoal jacket and a light shirt, photographed at an outdoor reception with a relaxed smile, soft natural eye contact, even daylight and realistic skin texture. It excluded text, logos, watermarks, celebrity resemblance, distorted eyes and exaggerated sharpening. The generated PNG remains in the Codex image library; the project uses a compressed JPEG copy.

The group-photo prompt used the fictional Noah reference and requested a new landscape 3:2 candid reception image: preserve the man's face, hair and charcoal jacket; show him on the left at a slight angle, talking with two other adult guests in daylight; no text, boxes or UI. The face outline is drawn by the application, with an explicitly simulated box and score. The original generated PNG is retained in the Codex image library; the app uses a compressed JPEG.
