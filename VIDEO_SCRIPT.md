# Demo video script (2-3 min, PRD section 13 beats)

Record at 1440x900 or similar, browser full screen, demo account signed in, dashboard populated.
Cursor moves slow and deliberate. Suggested voiceover lines are in quotes; trim freely.

## Beat 1: the problem (5-10s)

Screen: a cluttered Gmail inbox, search "order" showing dozens of merchant emails.

> "Every package I'm waiting for lives somewhere in this pile. Amazon, Temu, AliExpress, the local
> pet-food shop. Finding out what arrives when means digging. So I stopped digging."

## Beat 2: onboarding + the live moment (25-35s)

Screen: iTrack onboarding "Add your orders". Click "Add an order", paste the full text of a real
order email into the dialog, click Add.

> "I paste any order email, a confirmation or a shipping notice, and that's it."

Screen: cut to the dashboard: the card appears live with the product image, merchant, progress bar,
and countdown.

> "iTrack read the merchant, the items, the total, the promised date, and the tracking number, and
> turned it into a live card. No setup, no forwarding."

Screen: Settings or onboarding showing "Gmail connected (read-only)", then the dashboard's Scan my
inbox button running with the progress counter.

> "Or skip the pasting entirely: connect your own Gmail read-only, and iTrack scans the last 60
> days of order mail through your own token. Every card on this board came from my real inbox."

## Beat 3: card anatomy (15-20s)

Screen: hover a card. Zoom on the progress bar.

> "Product image, status, and a progress bar from order day to the promised date, with a marker for
> today. This one arrives in three days. That one is overdue, and iTrack noticed."

## Beat 4: timeline (15-20s)

Screen: click the card, scroll the detail view.

> "Every email about an order lands on one timeline: confirmed, shipped, out for delivery. Each
> event keeps its source snippet, the tracking number has a copy button, and the carrier link goes
> straight to the right tracking page."

## Beat 5: refund radar (25-30s)

Screen: the overdue card's red accent + refund badge, then the Refunds screen.

> "Here's the part that pays for itself. This order missed its promised date, so iTrack opened a
> case. It only offers a refund route when there's real evidence, the merchant's own policy or how
> I actually paid, and it drafted the claim with my order number and dates already in it. One
> click to copy, one click to the claim page. When the money lands, I mark it recovered."

## Beat 6: WhatsApp (20-25s)

Screen: phone recording or screen mirror: WhatsApp chat with iTrack assistant.
Type: "where's my dog food?"

> "And when I'm out: the iTrack assistant on WhatsApp. It only sees my own orders, and it answers
> like a human: status, ETA, days left."

## Beat 7: architecture close (10s)

Screen: the README architecture diagram (or a slide with the six checklist rows).

> "Under the hood: Base44 all the way down. Seven entities behind row-level security, twelve Deno
> backend functions, an LLM extraction pipeline with strict JSON schemas, realtime subscriptions,
> re-hosted media, and a tool-using agent. Paste one email and try it."

End card: iTrack logo + live URL.
