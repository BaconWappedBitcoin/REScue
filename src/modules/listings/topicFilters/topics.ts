/**
 * The bundled topic lists behind the "Topic filters" module: a curated, static map from a topic to
 * the active subreddits that belong to it. Nothing is looked up online. A subreddit may appear in
 * more than one topic. Names are lowercase, without "r/". Only subreddits that exist and are
 * active are listed; the reader can add more per topic (the module's "extra" table).
 */

export interface Topic {
  label: string;
  description: string;
  /** Three well-known members for the settings description. */
  sample: readonly string[];
  subreddits: readonly string[];
}

/** Whitespace-separated names, so each topic below reads as a paragraph instead of 100 lines. */
const names = (text: string): readonly string[] => text.split(/\s+/).filter(Boolean);

const SPORTS = names(`
sports nfl nba mlb nhl mls soccer football cfb collegebasketball collegefootball ncaa marchmadness
nbadiscussion nflnoobs fantasyfootball fantasybball fantasybaseball fantasyhockey fantasypl
dynastyff sportsbook sportsbetting wnba cfl
49ers buffalobills miamidolphins patriots nyjets ravens bengals browns steelers texans colts
jaguars tennesseetitans denverbroncos kansascitychiefs raiders chargers cowboys nygiants eagles
commanders chibears detroitlions greenbaypackers minnesotavikings falcons panthers saints
buccaneers azcardinals rams seahawks
lakers warriors bostonceltics nyknicks chicagobulls torontoraptors heat sixers gonets
clevelandcavs pacers mkebucks detroitpistons hornets atlantahawks washingtonwizards orlandomagic
denvernuggets timberwolves thunder ripcity utahjazz laclippers suns kings nbaspurs rockets
mavericks memphisgrizzlies nolapelicans
baseball redsox yankees mets dodgers sfgiants cubs whitesox braves phillies nationals orioles
bluejays tampabayrays clevelandguardians motorcitykitties kcroyals minnesotatwins astros
texasrangers angelsbaseball oaklandathletics mariners padres azdiamondbacks coloradorockies reds
cardinals buccos brewers letsgomets
hockey bostonbruins leafs habs rangers newyorkislanders devils flyers penguins caps canes
tampabaylightning floridapanthers detroitredwings hawks stlouisblues predators wildhockey
coloradoavalanche edmontonoilers calgaryflames canucks goldenknights sanjosesharks lakings
anaheimducks seattlekraken winnipegjets ottawasenators sabres bluejackets dallasstars
premierleague championship laliga bundesliga seriea ligue1 championsleague europaleague worldcup
soccerbanter footballmanagergames reddevils liverpoolfc chelseafc arsenal coys mcfc nufc avfc
whufc everton lcfc brighton crystalpalace fulham afcbournemouth nffc wolves lufc safc barca
realmadrid atletico sevilla juve acmilan intermilan asroma sscnapoli lazio borussiadortmund
fcbayern bayerleverkusen psg benfica ajax celtic rangersfc lafc intermiamicf soundersfc timbers
atlutd nycfc nyredbulls orlandocity lagalaxy fcdallas sportingkc uswnt nwsl ligamx
formula1 formuladank f1technical motorsport indycar nascar motogp
ufc mma mmanews boxing squaredcircle wwe aewofficial bjj
tennis golf progolf cricket cricketshitpost ipl rugbyunion rugbyleague rugby afl nrl
olympics trackandfield swimming volleyball curling cycling
lsu rolltide georgiabulldogs ohiostatebuckeyes texaslonghorns aggies sooners gators fsu clemson
oregonducks michiganwolverines
nflcirclejerk nbacirclejerk soccercirclejerk hockeyplayers
`);

const ANIME = names(`
anime manga animemes anime_irl animenews animesuggest goodanimemes awwnime animewallpaper
moescape okbuddybaka isekai manhwa manhua webtoons yuri wholesomeyuri otaku
attackontitan onepiece naruto boruto bleach dragonball dragonballsuper jujutsukaisen demonslayer
myheroacademia chainsawman spyxfamily oshinoko frieren sololeveling hunterxhunter
fullmetalalchemist evangelion shitpostcrusaders berserk vinlandsaga tokyoghoul deathnote
codegeass steinsgate cowboybebop gintama haikyuu blackclover fairytail madeinabyss mushokutensei
rezero konosuba overlord sailormoon onepunchman kaguyasama toradora
`);

const POLITICS = names(`
politics politicaldiscussion moderatepolitics neutralpolitics ask_politics conservative
conservatives liberal democrats republican progressive libertarian socialism communism neoliberal
esist sandersforpresident wayofthebern political_revolution voteblue askaconservative askaliberal
politicalhumor politicalcompassmemes politicalcompass libertarianmeme worldpolitics geopolitics
ukpolitics tories labouruk greenandpleasant canadapolitics onguardforthee canadianconservative
auspol indiaspeaks anarchism latestagecapitalism enoughtrumpspam centrist walkaway ronpaul
joebiden republicans uspolitics
`);

const NEWS = names(`
news worldnews inthenews upliftingnews nottheonion offbeat worldevents ukraine russia israel
palestine israelpalestine geopolitics credibledefense combatfootage ukrainewarvideoreport
syriancivilwar truereddit neutralnews anime_titties qualitynews
`);

const GAMING = names(`
gaming games pcgaming pcmasterrace ps5 playstation xbox xboxone xboxseriesx nintendoswitch
nintendo steam steamdeck truegaming patientgamers gamedeals gamingleaksandrumours indiegaming
indiegames gamephysics gamingcirclejerk emulation retrogaming speedrun twitch livestreamfail
minecraft fortnite fortnitebr leagueoflegends dota2 valorant csgo globaloffensive counterstrike
overwatch apexlegends callofduty warzone battlefield rainbow6 pubg gtaonline gta gtav
reddeadredemption reddeadonline eldenring darksouls darksouls3 bloodborne skyrim fallout fo76
starfield baldursgate3 cyberpunkgame witcher thelastofus godofwar zelda breath_of_the_wild
tearsofthekingdom supermario mariokart smashbros pokemon pokemongo animalcrossing splatoon kirby
metroid fireemblem persona5 finalfantasy ffxiv worldofwarcraft classicwow wow diablo diablo4
pathofexile hearthstone rocketleague roblox genshin_impact honkaistarrail destinythegame halo
haloinfinite forza forzahorizon simracing stardewvalley terraria subnautica hollowknight
celestegame undertale deltarune amongus fallguysgame lethalcompany palworld helldivers
monsterhunter monsterhunterworld residentevil silenthill nba2k madden fut rimworld factorio
civilization totalwar paradoxplaza stellaris starcitizen nomanssky elitedangerous eveonline
runescape 2007scape escapefromtarkov rust dayz 7daystodie lostark guildwars2 elderscrollsonline
assassinscreed farcry ghostoftsushima marvelrivals deadlockthegame smite
`);

const CELEBRITIES = names(`
popculturechat fauxmoi deuxmoi entertainment celebrities kardashiansnark
blogsnark youtubedrama livestreamfail taylorswift swifties beyonce rihanna billieeilish arianagrande
justinbieber selenagomez harrystyles onedirection oliviarodrigo dualipa sabrinacarpenter
chappellroan zendaya timotheechalamet ryangosling keanureeves ladygaga kanye realhousewives
bravotv thebachelor loveislandusa 90dayfiance teenmom tiktokcringe
`);

const CRYPTO = names(`
bitcoin btc cryptocurrency cryptomarkets ethereum ethtrader ethfinance dogecoin litecoin ripple xrp
cardano solana cryptotechnology cryptocurrencies bitcoinmarkets bitcoinbeginners binance coinbase
crypto_com cryptomoonshots satoshistreetbets shibainucoin polkadot chainlink defi nft bitcoincash
monero cryptocurrencytrading
wallstreetbets stocks investing options daytrading algotrading forex pennystocks robinhood
robinhoodpennystocks thetagang stockmarket securityanalysis valueinvesting dividends bogleheads
superstonk gme amcstock teslainvestorsclub swingtrading
`);

const MEMES = names(`
memes dankmemes me_irl meirl 2meirl4meirl wholesomememes memeeconomy historymemes prequelmemes
sequelmemes terriblefacebookmemes surrealmemes deepfriedmemes bonehurtingjuice comedycemetery
adviceanimals programmerhumor shitposting 196 antimeme lotrmemes marvelmemes dndmemes mathmemes
physicsmemes animemes goodanimemes okbuddyretard cursedcomments whitepeopletwitter
blackpeopletwitter oldpeoplefacebook boottoobig
`);

const TVMOVIES = names(`
movies television netflix hbo hbomax disneyplus marvelstudios marvel starwars startrek
gameofthrones asoiaf houseofthedragon thewalkingdead breakingbad bettercallsaul thesopranos
thewire thebear succession severance strangerthings squidgame theoffice friends seinfeld himym
brooklynninenine parksandrecreation community arresteddevelopment rickandmorty southpark
thesimpsons familyguy futurama bobsburgers adventuretime gravityfalls thelastairbender doctorwho
sherlock peakyblinders downtonabbey thecrown bridgerton theboys lotr harrypotter dune batman dcu
boxoffice criterion moviedetails filmmakers horror horrormovies moviesuggestions tvdetails
netflixbestof streaming cordcutters cinema shittymoviedetails oscars
`);

const MUSIC = names(`
music listentothis hiphopheads indieheads popheads metalheads metal rock classicrock punk jazz
classicalmusic edm electronicmusic techno house dubstep drumandbass countrymusic rap hiphop101
lofihiphop vinyl spotify
thebeatles radiohead pinkfloyd ledzeppelin queen metallica ironmaiden tool nirvana oasis
arcticmonkeys coldplay greenday linkinpark blink182 foofighters pearljam davidbowie prince
michaeljackson ladygaga beyonce frankocean tylerthecreator kendricklamar jcole eminem theweeknd
postmalone badbunny reggaeton taylorswift kanye travisscott
`);

const KPOP = names(`
kpop kpoppers kpoprants kpopthoughts kdrama kdramarecs bts bangtan blackpink twice straykids
newjeans aespa itzy lesserafim redvelvet enhypen ateez seventeen nct exo gidle girlsgeneration
mamamoo loona monstax shinee iu babymonster illit nmixx apink gfriend
`);

const DRAMA = names(`
amitheasshole aitah amioverreacting relationship_advice relationships bestofredditorupdates
tifu trueoffmychest offmychest confessions entitledparents entitledpeople choosingbeggars
justnomil raisedbynarcissists survivinginfidelity maliciouscompliance pettyrevenge prorevenge
nuclearrevenge idontworkherelady talesfromretail talesfromtechsupport talesfromcallcenters
talesfromthefrontdesk storiesaboutkevin insaneparents weddingshaming bridezillas childfree
dating_advice divorce advice
`);

const RELIGION = names(`
religion christianity atheism islam exchristian catholicism orthodoxchristianity buddhism
hinduism judaism mormon latterdaysaints exmormon jehovahswitnesses exjw debatereligion
truechristian christians catholic bahai sikh sikhism taoism paganism wicca satanism
thesatanictemple biblestudy askachristian exmuslim agnostic dankchristianmemes scientology
`);

const CARS = names(`
cars carporn justrolledintotheshop mechanicadvice cartalk whatcarshouldibuy tesla teslamotors
electricvehicles carspotting projectcar bmw mercedes_benz audi volkswagen porsche ferrari ford
f150 chevy mustang corvette dodge jeep toyota honda subaru wrx miata nissan mazda lexus volvo
offroad overlanding autodetailing leasehackr cybertruck
`);

export const TOPICS: Readonly<Record<string, Topic>> = {
  sports: {
    label: 'Sports',
    description: 'major leagues, team subreddits, fantasy leagues and sports betting',
    sample: ['nba', 'nfl', 'soccer'],
    subreddits: SPORTS,
  },
  anime: {
    label: 'Anime & manga',
    description: 'anime, manga and the big series subreddits',
    sample: ['anime', 'manga', 'onepiece'],
    subreddits: ANIME,
  },
  politics: {
    label: 'Politics',
    description: 'US and world politics, partisan subreddits and political humor',
    sample: ['politics', 'conservative', 'neoliberal'],
    subreddits: POLITICS,
  },
  news: {
    label: 'News & world events',
    description:
      'news, world-events, war and geopolitics subreddits (not country or city communities)',
    sample: ['news', 'worldnews', 'geopolitics'],
    subreddits: NEWS,
  },
  gaming: {
    label: 'Video games',
    description: 'general gaming, platforms and the biggest game subreddits',
    sample: ['gaming', 'pcgaming', 'minecraft'],
    subreddits: GAMING,
  },
  celebrities: {
    label: 'Celebrities & gossip',
    description: 'celebrity gossip, pop culture, reality TV and fan subreddits',
    sample: ['popculturechat', 'fauxmoi', 'taylorswift'],
    subreddits: CELEBRITIES,
  },
  crypto: {
    label: 'Crypto & trading',
    description: 'coins, exchanges and stock and options trading subreddits',
    sample: ['cryptocurrency', 'bitcoin', 'wallstreetbets'],
    subreddits: CRYPTO,
  },
  memes: {
    label: 'Memes',
    description: 'meme and shitposting subreddits',
    sample: ['memes', 'dankmemes', 'me_irl'],
    subreddits: MEMES,
  },
  tvmovies: {
    label: 'TV & movies',
    description: 'shows, movies, streaming services and fandoms',
    sample: ['movies', 'television', 'netflix'],
    subreddits: TVMOVIES,
  },
  music: {
    label: 'Music',
    description: 'genres, artists and music discussion',
    sample: ['music', 'hiphopheads', 'indieheads'],
    subreddits: MUSIC,
  },
  kpop: {
    label: 'K-pop',
    description: 'K-pop groups, K-drama and fan subreddits',
    sample: ['kpop', 'bts', 'blackpink'],
    subreddits: KPOP,
  },
  drama: {
    label: 'Relationship & drama stories',
    description: 'AITA, relationship advice, revenge and entitled-people stories',
    sample: ['amitheasshole', 'relationship_advice', 'tifu'],
    subreddits: DRAMA,
  },
  religion: {
    label: 'Religion',
    description: 'religions, denominations and atheism',
    sample: ['christianity', 'atheism', 'islam'],
    subreddits: RELIGION,
  },
  cars: {
    label: 'Cars',
    description: 'car discussion, brands and car culture',
    sample: ['cars', 'justrolledintotheshop', 'tesla'],
    subreddits: CARS,
  },
};

export const TOPIC_IDS: readonly string[] = Object.keys(TOPICS);

/** The option name that switches a topic on. */
export const topicOption = (id: string): string => `topic_${id}`;

/** A reader-typed subreddit as the bare lowercase name ("r/NBA" and "/r/nba" give "nba"). */
export const bareSub = (s: unknown): string =>
  String(s ?? '')
    .trim()
    .replace(/^\/?r\//i, '')
    .toLowerCase();

/** What a subreddit name has to look like (Reddit allows 3 to 21; two-letter ones exist). */
export const SUBREDDIT_NAME = /^[a-z0-9_]{2,21}$/;

/** "e.g. r/nba, r/nfl, r/soccer and 140 more" for a topic's settings description. */
export function sampleText(id: string): string {
  const topic = TOPICS[id];
  const shown = (topic?.sample ?? []).map((s) => `r/${s}`);
  const rest = (topic?.subreddits.length ?? 0) - shown.length;
  return `e.g. ${shown.join(', ')}${rest > 0 ? ` and ${rest} more` : ''}`;
}
