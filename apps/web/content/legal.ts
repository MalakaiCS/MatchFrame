// The Terms and Conditions and the Privacy Policy. General terms written for MatchFrame as it works today (what it
// stores, which cookies it sets, how plans and payments work) and approved for use by the owner on 24 October 2026.
// They name no legal entity, address or governing law: add those, and have the text reviewed, before relying on it
// in a dispute. When the product changes what it collects or how billing works, change this file in the same commit
// and move LEGAL_UPDATED on. Inline markup: [label](/href) and **bold**.

export const LEGAL_UPDATED = '24 October 2026';

export type LegalBlock = string | { list: string[] };
export interface LegalSection {
  id: string;
  title: string;
  body: LegalBlock[];
}

export const TERMS: LegalSection[] = [
  {
    id: 'about',
    title: 'About these terms',
    body: [
      'These terms are an agreement between you and the operator of MatchFrame ("MatchFrame", "we", "us") about using the MatchFrame website, apps and services: live scoring, broadcast graphics, automation, sponsor placements, streaming tools, the media library and highlights.',
      'By creating an account, joining an organisation or using MatchFrame, you agree to these terms and to the [Privacy Policy](/privacy). If you use MatchFrame for a club, league, school or company, you confirm you are allowed to accept these terms for it, and "you" includes that organisation.',
    ],
  },
  {
    id: 'accounts',
    title: 'Accounts and organisations',
    body: [
      {
        list: [
          'You need to be at least 18, or have the permission of a parent or guardian and of the organisation that invites you.',
          'Give accurate details and keep your sign-in methods (password, passkeys, codes sent to your email or phone, and linked Google, Apple, Microsoft or Facebook accounts) to yourself. Tell us through the [contact page](/contact) if you think someone else has got in.',
          'Your work in MatchFrame belongs to an organisation. Its owners and admins decide who joins, what role each person has, and which matches, outputs and media they can reach. Organisation owners are responsible for what their team members do in MatchFrame.',
          'Two-step sign-in is available to everyone, and an organisation can require it of its members.',
        ],
      },
    ],
  },
  {
    id: 'plans',
    title: 'Plans, payments and cancelling',
    body: [
      'The plans and prices are on the [pricing page](/pricing). The price, currency and any tax are shown before you pay.',
      {
        list: [
          '**Subscriptions.** Starter, Club and Studio are paid in advance, monthly or yearly, through our payment provider, Stripe. We never see or store your full card details. A subscription renews automatically at the end of each period until it is cancelled.',
          '**Cancelling.** An organisation owner can cancel or change the plan in Settings → Plan → Manage billing. Unless you choose otherwise there, the plan stays until the end of the period already paid for and is not renewed.',
          '**Refunds.** Payments for a period that has started are not refunded, except where the law requires it or we agree to.',
          '**Failed payments.** If a renewal cannot be charged, Stripe tries again for a while. If it still fails, the subscription ends and the organisation goes back to having no plan.',
          '**Price changes.** We tell organisation owners by email before a new price applies to their next renewal. You can cancel before it does.',
          '**Quoted plans.** League / Enterprise and other arrangements agreed with us in writing follow that quote or agreement where it differs from these terms.',
          '**Plans given by MatchFrame staff.** We may put an organisation on a plan for a set time, for example a trial, a sponsored season or while an invoice is settled. Settings → Plan shows when it ends. On that date the organisation goes back to the plan it had before, or to its paid subscription.',
        ],
      },
    ],
  },
  {
    id: 'your-content',
    title: 'Your content',
    body: [
      'Your content is everything you or your organisation puts into MatchFrame: teams, players, officials, fixtures, scores and events, logos and photos, sponsor artwork, videos and recordings, and the graphics and highlights made from them.',
      {
        list: [
          'You keep ownership of your content. You let us store, copy, process and display it only as needed to run MatchFrame for you: drawing your graphics, sending outputs to the places you choose, building highlights, and showing the public pages and share links you turn on.',
          'You must have the rights to everything you upload and broadcast. That includes the right to broadcast or stream the match itself (competitions, leagues and venues often have their own broadcast rules), and the right to use team names and crests, player names and photos, sponsor marks, music and footage.',
          'If your graphics, public pages or videos show players under 18, you are responsible for any consent your club, league or the law requires.',
          'Public match pages and share links can be seen by anyone who has the link. Turn them off when you no longer want them public.',
        ],
      },
    ],
  },
  {
    id: 'acceptable-use',
    title: 'Acceptable use',
    body: [
      'Do not use MatchFrame to:',
      {
        list: [
          'break the law, or broadcast or share content you do not have the rights to;',
          'post content that is defamatory, harassing, hateful, sexually explicit or that invades someone’s privacy;',
          'pretend to be another person, club, league or sponsor;',
          'get into accounts, organisations or data that are not yours, test our security without our written permission, or interfere with the service, for example by overloading it or spreading malware;',
          'copy, resell or rebuild MatchFrame, its looks or its templates as a competing product.',
        ],
      },
      'We may remove content or take down public pages and share links that break these terms, and tell the organisation why.',
    ],
  },
  {
    id: 'live-production',
    title: 'Live production',
    body: [
      'Live matches depend on things outside our control: the internet at the venue, phones and computers, OBS or other production software, and the streaming platforms you send to. Rehearse before a match, keep a fallback, and check your output before going live. Scoring keeps working offline and catches up, but graphics and streams need a connection.',
      'Features marked **Beta** work but are still being proven at more matches. Features marked **Coming soon** are not available yet. Features marked **Requires media server** only work on an installation that runs one.',
    ],
  },
  {
    id: 'service',
    title: 'The service and support',
    body: [
      'We keep improving MatchFrame, so features change. We aim to keep the service available but do not promise it will be uninterrupted or free of errors. When we plan maintenance that could affect live matches, we try to give notice.',
      'Help is through the [documentation](/docs), the [FAQ](/faq) and the [contact page](/contact). We reply by email and do not promise response times or live matchday support unless a plan or a written agreement says so.',
      'If you run MatchFrame on your own servers under a separate agreement with us, that agreement applies alongside these terms.',
    ],
  },
  {
    id: 'third-parties',
    title: 'Other services',
    body: [
      'MatchFrame works with services we do not run: Stripe for payments; Google, Apple, Microsoft and Facebook for sign-in; OBS, vMix and other production software; and YouTube, Facebook and other platforms you stream to. Their own terms apply when you use them, and we are not responsible for them.',
    ],
  },
  {
    id: 'ours',
    title: 'Our software and looks',
    body: [
      'MatchFrame, including its software, graphics looks, templates, animations and documentation, belongs to us and our licensors. While your organisation has access, you may use it to produce and publish your own matches. The graphics and videos you make with your content are yours to use for those matches and to promote them.',
    ],
  },
  {
    id: 'ending',
    title: 'Suspending and closing accounts',
    body: [
      'You can stop using MatchFrame at any time, and ask us to close your account or your organisation through the [contact page](/contact).',
      'We may suspend or close an account or organisation that breaks these terms, does not pay, or puts the service or other people at risk. Where we can, we tell you first and give you a chance to fix it. Site staff record every suspension.',
      'After an organisation is closed we delete or anonymise its content within a reasonable time, except what the law requires us to keep. Copies in backups are removed as the backups expire. Ask us before closing if you want a copy of your data.',
    ],
  },
  {
    id: 'liability',
    title: 'Warranties and liability',
    body: [
      'Some laws, such as consumer guarantees, give you rights that cannot be excluded. Nothing in these terms limits those rights.',
      'Otherwise, MatchFrame is provided "as is". As far as the law allows:',
      {
        list: [
          'we are not liable for indirect or consequential loss, such as lost revenue, lost sponsorship, lost viewers, or a broadcast that was interrupted or not made;',
          'our total liability for any claim about MatchFrame is limited to the amount your organisation paid us in the 12 months before the claim arose.',
        ],
      },
      'You are responsible for claims made against us because of content you uploaded or broadcast without the rights to do so, or because you broke these terms.',
    ],
  },
  {
    id: 'changes',
    title: 'Changes to these terms',
    body: [
      'We may update these terms as MatchFrame changes. The date at the top shows the latest version. For changes that matter, we tell organisation owners by email or in the app before they apply. If you keep using MatchFrame after that, the new terms apply.',
    ],
  },
  {
    id: 'law',
    title: 'Governing law and contact',
    body: [
      'These terms are governed by the laws of the place where the operator of MatchFrame is established, unless the law where you live gives you the right to rely on its laws or courts.',
      'Questions about these terms: use the [contact page](/contact).',
    ],
  },
];

export const PRIVACY: LegalSection[] = [
  {
    id: 'summary',
    title: 'In short',
    body: [
      {
        list: [
          'We collect what MatchFrame needs to sign you in, run your matches and graphics, take payment and answer your messages.',
          'We do not sell personal information, show ads or use analytics or advertising cookies.',
          'Your organisation decides what goes into its matches and media. We look after that data on its behalf.',
          'You can ask to see, correct, export or delete your information through the [contact page](/contact).',
        ],
      },
    ],
  },
  {
    id: 'roles',
    title: 'Who is responsible',
    body: [
      'For account details, sign-in, billing, this website and messages sent to us, the operator of MatchFrame decides how information is used, as this policy describes.',
      'For the information an organisation puts into MatchFrame (its teams, players, officials, matches, events, photos, recordings and sponsors), the organisation decides what is collected and why, and we process it on its behalf to run the service. If you are a player or official and have a question about how your club or league uses your details, ask them first; we will help them answer.',
    ],
  },
  {
    id: 'collect',
    title: 'What we collect',
    body: [
      {
        list: [
          '**Account details**: your name, email address and, if you add one, a mobile number for sign-in codes; a password (stored only as a one-way hash), passkeys (only their public part) and two-step sign-in settings (encrypted).',
          '**Sign-in providers**: if you sign in with Google, Apple, Microsoft or Facebook, the account identifier, name and email address that provider shares with us. We do not get your password for that account.',
          '**Sign-in sessions and security records**: when and from which browser and IP address you signed in, and a record of important changes (for example who took a graphic to air, changed a score or changed a plan) in the organisation’s activity log. Site staff actions are also logged.',
          '**Organisation content**: teams, players (names, numbers, positions, photos), officials, competitions, fixtures, scores and match events, line-ups, sponsor artwork, uploaded images and videos, recordings, highlights and exports, and the settings for graphics, automation and streams. Stream keys and other destination credentials are stored encrypted.',
          '**Billing**: the plan, its status and renewal date, and the customer and subscription references from Stripe. Card details go straight to Stripe; we never see the full number.',
          '**Messages to us**: what you send through the contact form (name, email, topic, organisation, sport, plan and message) and our replies.',
          '**Notifications**: if you turn on browser notifications, the subscription your browser gives us to deliver them.',
        ],
      },
    ],
  },
  {
    id: 'use',
    title: 'How we use it',
    body: [
      {
        list: [
          'to create your account, sign you in, send sign-in codes and links, and keep accounts secure;',
          'to run your organisation’s matches: scoring, graphics, automation, sponsor placements, public pages you turn on, streams, recordings and highlights;',
          'to take payments and manage plans;',
          'to send service emails, such as invitations, verification, sign-in codes, match reminders and billing notices (these are not marketing, and we do not add you to mailing lists);',
          'to answer messages and give support;',
          'to keep MatchFrame working and safe: fixing faults, preventing abuse and keeping the records described above.',
        ],
      },
      'We use information this way to provide the service you asked for, to meet legal obligations, and where it is in our legitimate interest to keep the service secure and working. Where the law requires consent, we ask for it.',
    ],
  },
  {
    id: 'public',
    title: 'What is public',
    body: [
      'Graphics, streams and videos you broadcast are seen by your audience. Public match pages and share links you turn on can be opened by anyone with the link, and show what your organisation chose to publish, such as team and player names and the score. Organisations can turn them off at any time.',
    ],
  },
  {
    id: 'sharing',
    title: 'Who we share it with',
    body: [
      'We share information only with the services that help us run MatchFrame, and only what each one needs:',
      {
        list: [
          'hosting, database and file storage providers;',
          'an email delivery provider, for service emails;',
          'Stripe, for payments;',
          'Twilio, for text-message sign-in codes, when that is switched on;',
          'Google, Apple, Microsoft or Facebook, when you choose to sign in with them;',
          'the streaming platforms and destinations your organisation sends its output to.',
        ],
      },
      'We may also disclose information when the law requires it, to protect people’s safety, or to a buyer if MatchFrame is sold (who would have to respect this policy). We do not sell personal information.',
      'Some providers store or process data in other countries. Where the law requires it, we use safeguards such as contractual protections.',
    ],
  },
  {
    id: 'device',
    title: 'Cookies and storage on your device',
    body: [
      'MatchFrame uses only the cookies needed to sign you in, keep you signed in and, if you choose, remember a trusted device for two-step sign-in. There are no analytics or advertising cookies.',
      'Your browser also keeps a few things on your device, which never leave it unless you sign in and use them:',
      {
        list: [
          'light or dark mode;',
          'the last way you signed in, so the sign-in page can offer it first;',
          'a plan you picked on the pricing page, for one day, so sign-up can carry it through;',
          'whether the app’s sidebar is collapsed;',
          'the scorer app’s settings, and scores waiting to be sent while the phone is offline.',
        ],
      },
    ],
  },
  {
    id: 'keep',
    title: 'How long we keep it',
    body: [
      {
        list: [
          'Account details: while you have an account, then deleted or anonymised.',
          'Organisation content and its activity log: while the organisation exists, unless the organisation deletes items sooner. Recordings are kept for 90 days and exports for 30 days by default.',
          'Sign-in sessions: until they expire (14 days without use by default) or you sign out.',
          'Contact messages: deleted automatically 12 months after they arrive.',
          'Backups: replaced on a rolling basis, about every two weeks.',
          'Billing records: as long as tax and accounting laws require.',
        ],
      },
    ],
  },
  {
    id: 'security',
    title: 'Security',
    body: [
      'Passwords are hashed; stream keys, two-step sign-in secrets and other credentials are encrypted; each organisation’s data is kept apart in the database and checked on every request; and two-step sign-in is available and can be required. No system is perfectly secure. If a breach is likely to cause serious harm, we will tell the people affected and the regulator, as the law requires.',
    ],
  },
  {
    id: 'rights',
    title: 'Your choices and rights',
    body: [
      'You can update your name, email, mobile number, passkeys and linked sign-in accounts in Settings → Security. Depending on where you live, you may also have the right to ask for a copy of your information, to have it corrected or deleted, to object to or limit some uses, or to take it to another service. Ask through the [contact page](/contact); we may need to confirm who you are first. For information that belongs to an organisation, we will work with that organisation to answer.',
      'If you are not happy with our answer, you can complain to the privacy or data protection regulator where you live.',
    ],
  },
  {
    id: 'children',
    title: 'Children',
    body: [
      'MatchFrame accounts are for adults and for people with their parent’s or guardian’s and their organisation’s permission. Clubs that show junior players in graphics, public pages or videos are responsible for the consent their league and the law require.',
    ],
  },
  {
    id: 'changes',
    title: 'Changes and contact',
    body: [
      'We update this policy when MatchFrame changes what it collects or how it uses it. The date at the top shows the latest version, and we tell account holders about important changes by email or in the app.',
      'Questions or requests about privacy: use the [contact page](/contact) and choose "Something else".',
    ],
  },
];
