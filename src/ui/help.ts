// The phone's Help app: a window in the middle of the screen that explains each part of the game, topic by topic.
import { notify } from '../core/store.js';
import { icon } from './icons.js';
import { ACT } from './reg.js';

interface Topic { id: string; icon: string; title: string; intro: string; items: [string, string][] }
const TOPICS: Topic[] = [
    { id: 'start', icon: 'home', title: 'Getting started', intro: 'Mundi turns a SillyTavern group chat into a life you live: a city, a clock, needs, people with their own days, and the story the AI writes around what you do.',
        items: [
            ['Your card (top left)', 'Your name, money, energy and needs. Click your photo to play as someone else.'],
            ['The clock (top)', 'The day, the time, where you are and the weather. Time passes when you do things, travel or sleep.'],
            ['Here', 'Who is with you right now. Click a face for what you can do with that person.'],
            ['Things to do (right)', 'What this place offers: eat, drink, work, rest… and "Something else…" for anything you can think of.'],
            ['Map', 'Go to other places. Travelling takes time; the people you are with can come along.'],
        ] },
    { id: 'talk', icon: 'chat', title: 'Talking', intro: 'Write in the box under the story. The engine keeps the numbers (time, money, relationships); the AI writes the scene.',
        items: [
            ['Say, Do, Story, See', 'Say: what you say out loud. Do: what you do. Story: a direction for the story ("it starts to rain"). See: ask the narrator to describe something.'],
            ['@ someone', 'Type @ and pick a name: only that person answers your line.'],
            ['Talk only with them', 'On a person\'s card: the others stay but give you space.'],
            ['Buttons on a line', 'Edit, delete, regenerate, continue, or let the AI write your line.'],
            ['Bonds grow as you talk', 'Being kind brings people closer (a little each line, up to a limit each day). Rude lines push them away.'],
        ] },
    { id: 'needs', icon: 'bolt', title: 'Time and needs', intro: 'Energy, hunger, thirst, mood and hygiene drop over time. Keep them up with the things you do.',
        items: [
            ['Actions take time', 'Each action shows its cost and how long it takes. The clock moves forward when you do it.'],
            ['Sleep', 'At home (or where you stay the night). The night ends the day: your diary is written and you see how the day went with everyone.'],
            ['Let time pass', 'In the ☰ menu, to skip ahead.'],
            ['Rent and bills', 'Rent, water and power are weekly bills: pay them in the Homes app (they turn red when due). One left unpaid for a week is cut off: no water, no power, or locked out of your home.'],
            ['Difficulty', 'Easy, Normal or Hard (chosen when you start, changeable in ☰ → This world): it changes what work pays and what things cost.'],
            ['Events lift your mood', 'Being on a date or at a party raises your mood and keeps it up while it lasts.'],
        ] },
    { id: 'people', icon: 'heart', title: 'People and relationships', intro: 'Everyone has two bars: friendship and romance. Each bar fills inside its level, then the level goes up and the bar changes color.',
        items: [
            ['Levels', 'Stranger, acquaintance, friend, good friend, best friend; and for romance, from a crush up to love.'],
            ['Asking someone out', 'From their card or with your own words ("will you be my girlfriend?"). The engine decides how ready they are; the scene shows the answer. If they need time, wait before asking again.'],
            ['Proposing, marriage, a baby', 'Once you are a couple, the next steps appear on their card.'],
            ['What they think of you', 'Approval goes up when you keep your word and down when you let people down. Feelings (happy, hurt…) fade with the days.'],
            ['Their own lives', 'People work, go out and sleep on their own schedule. Find them where they are, or text them.'],
        ] },
    { id: 'plans', icon: 'calendar', title: 'Plans and events', intro: 'Invite people to hang out, go on a date or come to your party. A plan becomes an event when it starts.',
        items: [
            ['Make plans', 'From a person\'s card (in person) or the phone. Choose where, when, and give it a name: the story will be about it ("Movie night").'],
            ['Getting there', 'An hour before, "Things to do" lets you wait for them; half an hour before, a reminder asks if you want to go.'],
            ['During the event', 'A panel shows it. End it to say goodbye (they tell you what they thought), or ask them to stay the night.'],
            ['A party', 'From the Calendar app: invite several people at once. You wait for all your guests in one go.'],
            ['Standing someone up', 'They wait an hour, text you, and remember it.'],
        ] },
    { id: 'work', icon: 'briefcase', title: 'Work and money', intro: 'Find a job in the Jobs app or at the place itself, then work your shifts. The Work button (top right) takes you there.',
        items: [
            ['Job interviews', 'Applying is a roll: the traits the job looks for are your bonus (the chance is shown). If it goes wrong, try again the next day. Shower first: nobody hires someone who smells.'],
            ['Courses', 'At home (online) or at the University: pay once, then study 2 h a day for a few days. You learn its traits for good, and some jobs (doctor, developer, teacher…) need a course.'],
            ['Shifts', 'Choose how hard you work. If you have plans, you can work part of the shift and then go.'],
            ['Promotions', 'Each shift brings you closer to the next rank and a better salary.'],
            ['Quick gigs', 'Some places offer one-off work for quick money.'],
            ['Bank and Shop', 'See where your money goes, and buy things that make life easier.'],
            ['At home', 'Every home has an old TV to unwind a little; better things come from the Shop.'],
        ] },
    { id: 'phone', icon: 'phone', title: 'The phone', intro: 'The phone in the corner holds your apps.',
        items: [
            ['Messages', 'Text anyone you have met. The ✎ pencil renames a contact and lets you delete messages.'],
            ['People', 'Everyone you know, with their bars and what they feel.'],
            ['Chirp and Spark', 'The social network and the dating app.'],
            ['Calendar', 'Your plans, who is with you, and parties.'],
            ['Journal', 'A calendar of your days, with each day\'s diary and what happened.'],
            ['Profile', 'Your skills, traits, courses, life goals and career, like a professional profile.'],
            ['Goals', 'Pick a life goal. Reaching it gives you a trait for good.'],
            ['Settings', 'Change the wallpaper: a picture from your computer, a link, or your gallery.'],
        ] },
    { id: 'journal', icon: 'book', title: 'Memory and the diary', intro: 'Mundi remembers in short facts ("You met Bianca at the café"). The AI gets only the facts of the people in the scene.',
        items: [
            ['The diary', 'Written when you sleep, from the day\'s facts and conversations. It tells the AI what happened on the days before.'],
            ['Translated', 'If SillyTavern\'s Chat Translation translates the replies, the diary and Mundi\'s ready-made lines are translated too.'],
            ['Remember this', 'On a line of the story: turns it into a fact.'],
        ] },
    { id: 'family', icon: 'users', title: 'Households and family', intro: 'People who live together share a home, like in The Sims.',
        items: [
            ['Your household', 'The faces under your card. Click one to play as them, call them over or go to them.'],
            ['Households', 'In ☰ → This world: who lives where, and how they are related.'],
            ['Children', 'A baby grows a stage at each birthday, once a week. Celebrate it from their card.'],
        ] },
    { id: 'playas', icon: 'user', title: 'Play as someone else', intro: 'Click your photo to switch to another person of the world.',
        items: [
            ['Choosing who you can play', '"Choose who you can play" keeps people ready; you switch only when you click one.'],
            ['What changes', 'You go where they are and live in their home. Each person keeps their own relationships, diary and job.'],
            ['What stays', 'Energy, needs and money are the same for everyone you play.'],
            ['The one you were', 'Stays where they were, or with you if they were your company.'],
        ] },
    { id: 'look', icon: 'palette', title: 'Look and settings', intro: 'Make it yours.',
        items: [
            ['Chat look (☰ menu)', 'Visual novel, Classic or Cards; sizes; colors with transparency; colors from a SillyTavern theme.'],
            ['Presets', 'Mundi\'s presets (Midnight Glass, Rose Dusk, Forest Calm) and your own. They also tint the HUD\'s glass.'],
            ['This world', 'People, homes, households and what the AI is told (AI context).'],
            ['A red warning on top', 'Something in SillyTavern may hurt the game (context too big, Summarize on…). It says what to change.'],
            ['Tip', 'A context of about 30k tokens works well. Keep it the same in SillyTavern and in your AI program.'],
        ] },
];

const H = { open: false, topic: 'start' };
export const openHelp = () => { H.open = true; notify(); };

export function helpHtml(): string {
    if (!H.open) return '';
    const t = TOPICS.find(x => x.id === H.topic) ?? TOPICS[0];
    return `<div class="mu-recap-veil mu-help-veil" data-act="help-bg"><section class="mu-recap mh-glass mu-help" role="dialog" aria-label="Help">
        <header class="mu-row"><div><small>Help</small><h3>How Mundi works</h3></div><button class="mu-ibtn mu-ghost mu-right" data-act="help-close" aria-label="Close">${icon('x')}</button></header>
        <div class="mu-help-body">
            <nav class="mu-help-nav">${TOPICS.map(x => `<button class="${x.id === t.id ? 'is-on' : ''}" data-act="help-topic" data-id="${x.id}">${icon(x.icon)}<span>${x.title}</span></button>`).join('')}</nav>
            <article class="mu-help-page" data-keep="help-page">
                <h4>${icon(t.icon)} ${t.title}</h4>
                <p class="mu-help-intro">${t.intro}</p>
                <dl>${t.items.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
            </article>
        </div></section></div>`;
}

Object.assign(ACT, {
    'help-close': () => { H.open = false; notify(); },
    'help-bg': (el, e) => { if (e.target === el) { H.open = false; notify(); } },
    'help-topic': (el) => { H.topic = el.dataset.id!; notify(); requestAnimationFrame(() => { const p = document.querySelector('#mundi-root .mu-help-page'); if (p) p.scrollTop = 0; }); },
});
