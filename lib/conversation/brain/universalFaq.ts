import type { Lang } from "@/lib/sectors";

/**
 * Universal_FAQ: everyday things any caller may say that no shop profile lists (who are you, a
 * joke, the weather, "what is the capital of France"). Answered word for word by the Code_Brain,
 * so they cost no model call and no API token. Pure data.
 *
 * Rules, the same as a shop's FAQ_Entry (11.2): Spoken_Form (no digit), no markup or emoji, 1 or 2
 * sentences of at most 25 words. Plus one of our own: an answer never states a fact about the shop
 * (its prices, hours, address, payment, parking); it only talks about the receptionist or steers
 * the caller back to what she can do. A shop's own FAQ_Entry wins over a Universal_FAQ alias.
 */
export interface UniversalFaq {
  id: string;
  aliases: Record<Lang, string[]>;
  answer: Record<Lang, string>;
}

const BACK = {
  es: "¿Te doy cita, o te cuento horarios y precios?",
  en: "Can I book you in, or tell you our hours and prices?",
};

export const UNIVERSAL_FAQ: readonly UniversalFaq[] = [
  {
    id: "u-robot",
    aliases: {
      es: ["eres un robot", "eres una maquina", "eres una persona", "eres humana", "eres humano", "eres real", "hablo con una persona", "hablo con una maquina", "eres una ia", "eres inteligencia artificial", "eres un bot", "eres una grabacion", "es una grabacion"],
      en: ["are you a robot", "are you a bot", "are you a machine", "are you human", "are you a real person", "am i talking to a person", "am i talking to a machine", "are you an ai", "are you artificial intelligence", "is this a recording", "is this a real person"],
    },
    answer: {
      es: "Soy la recepcionista con inteligencia artificial de este negocio. Puedo darte cita y resolver dudas, y si prefieres, dejo un mensaje a una persona.",
      en: "I'm this business's AI receptionist. I can book you in and answer questions, and if you prefer I'll leave a message for a person.",
    },
  },
  {
    id: "u-name",
    aliases: {
      es: ["como te llamas", "cual es tu nombre", "como te llaman", "quien eres", "con quien hablo", "quien habla", "tu nombre"],
      en: ["what's your name", "what is your name", "who are you", "who am i speaking to", "who am i talking to", "who is this", "your name"],
    },
    answer: {
      es: "Soy la recepcionista virtual de este negocio. Estoy para ayudarte con tu cita.",
      en: "I'm this business's virtual receptionist. I'm here to help you with your booking.",
    },
  },
  {
    id: "u-creator",
    aliases: {
      es: ["quien te ha creado", "quien te creo", "quien te ha hecho", "quien te hizo", "quien te programo", "con que funcionas", "como funcionas", "que tecnologia usas"],
      en: ["who made you", "who created you", "who built you", "who programmed you", "how do you work", "what technology do you use"],
    },
    answer: {
      es: "Soy Phantom Line, una recepcionista de voz con inteligencia artificial hecha para negocios con cita.",
      en: "I'm Phantom Line, an AI voice receptionist built for appointment-based businesses.",
    },
  },
  {
    id: "u-aboutyou",
    aliases: {
      es: ["hablame de ti", "cuentame de ti", "cuentame sobre ti", "presentate", "dime algo de ti", "como eres", "que eres exactamente"],
      en: ["tell me about yourself", "tell me about you", "introduce yourself", "say something about yourself", "what are you exactly", "what are you"],
    },
    answer: {
      es: `Soy una recepcionista virtual con inteligencia artificial y atiendo las llamadas de este negocio. ${BACK.es}`,
      en: `I'm a virtual receptionist with artificial intelligence and I answer this business's calls. ${BACK.en}`,
    },
  },
  {
    id: "u-clock",
    aliases: {
      es: ["que hora es", "me dices la hora", "sabes que hora es", "tienes hora", "me puedes decir la hora"],
      en: ["what time is it", "do you have the time", "can you tell me the time", "what's the time", "do you know what time it is"],
    },
    answer: {
      es: "No llevo reloj, pero te puedo decir el horario del negocio. Dime qué día te interesa.",
      en: "I don't have a clock, but I can tell you the business's hours. Tell me which day you need.",
    },
  },
  {
    id: "u-expensive",
    aliases: {
      es: ["sois caros", "es caro", "es muy caro", "es barato", "sois baratos", "cuanto cuesta todo", "cuanto sale todo", "que precios teneis mas o menos", "mas o menos cuanto cuesta", "me va a salir caro", "me sale caro"],
      en: ["is it expensive", "are you expensive", "is it cheap", "are you cheap", "is it pricey", "will it cost a lot", "roughly how much does it cost", "what are your prices roughly"],
    },
    answer: {
      es: "El precio depende de cada servicio. Dime cuál te interesa y te lo digo ahora mismo.",
      en: "The price depends on each service. Tell me which one you're after and I'll tell you right now.",
    },
  },
  {
    id: "u-howareyou",
    aliases: {
      es: ["como estas", "que tal estas", "que tal estas hoy", "como te va", "como andas", "que tal tu dia", "como va tu dia", "todo bien por ahi"],
      en: ["how are you", "how are you doing", "how's it going", "how is your day", "how's your day going", "how are things", "you good"],
    },
    answer: {
      es: `Muy bien, gracias por preguntar. ${BACK.es}`,
      en: `Very well, thanks for asking. ${BACK.en}`,
    },
  },
  {
    id: "u-whatcanyoudo",
    aliases: {
      es: ["que puedes hacer", "que sabes hacer", "en que me puedes ayudar", "en que puedes ayudarme", "para que sirves", "como me puedes ayudar"],
      en: ["what can you do", "how can you help me", "what can you help me with", "what are you for", "what can i do here"],
    },
    answer: {
      es: "Puedo darte cita, cambiarla o anularla, y contarte horarios, precios y servicios. También dejo un mensaje a una persona.",
      en: "I can book, change or cancel an appointment, and tell you about hours, prices and services. I can also leave a message for a person.",
    },
  },
  {
    id: "u-joke",
    aliases: {
      es: ["cuentame un chiste", "dime un chiste", "sabes algun chiste", "cuenta un chiste", "un chiste", "hazme reir", "dime algo gracioso", "cuentame algo gracioso"],
      en: ["tell me a joke", "say a joke", "do you know a joke", "know any jokes", "make me laugh", "tell me something funny", "got a joke"],
    },
    answer: {
      es: "Mi mejor chiste es una agenda sin huecos libres. Si quieres uno, te busco hueco ahora mismo.",
      en: "My best joke is a diary with no free slots. If you want a slot, I'll find you one right now.",
    },
  },
  {
    id: "u-sing",
    aliases: {
      es: ["cantame una cancion", "canta algo", "sabes cantar", "cantame algo", "dime un poema", "recitame algo"],
      en: ["sing me a song", "sing something", "can you sing", "sing for me", "recite a poem", "tell me a poem"],
    },
    answer: {
      es: `Cantar no se me da bien, lo mío es la agenda. ${BACK.es}`,
      en: `Singing isn't my strength, scheduling is. ${BACK.en}`,
    },
  },
  {
    id: "u-weather",
    aliases: {
      es: ["que tiempo hace", "va a llover", "hace frio", "hace calor", "que tiempo va a hacer", "que temperatura hace", "como esta el tiempo", "esta lloviendo", "va a hacer sol", "hace buen dia"],
      en: ["what's the weather", "what is the weather", "is it going to rain", "is it cold", "is it hot", "how's the weather", "is it raining", "is it sunny", "will it rain", "what's the temperature"],
    },
    answer: {
      es: `No tengo el tiempo a mano, mejor mira por la ventana. ${BACK.es}`,
      en: `I can't check the weather from here, better look out the window. ${BACK.en}`,
    },
  },
  {
    id: "u-offtopic",
    aliases: {
      es: [
        "cual es la capital de", "quien es el presidente", "quien gano el partido", "quien gano la liga", "que opinas de la politica", "cuentame las noticias", "que noticias hay", "cuanto es dos mas dos", "cuanto son dos mas dos", "cuanto es uno mas uno",
        "que dia es hoy", "que hora es en", "cual es el sentido de la vida", "cuantos habitantes tiene", "como se dice en ingles", "quien es el mejor futbolista", "quien ha ganado", "recomiendame una pelicula", "recomiendame un restaurante", "que me recomiendas para comer", "que hago hoy", "tienes novia", "tienes novio", "estas casada", "estas casado", "cuantos anos tienes", "donde vives", "de donde eres",
      ],
      en: [
        "what's the capital of", "what is the capital of", "who is the president", "who won the game", "who won the match", "what do you think about politics", "tell me the news", "what's the news", "what is two plus two", "what's two plus two", "what is one plus one",
        "what's the meaning of life", "what is the meaning of life", "how many people live in", "how do you say in spanish", "who is the best football player", "who won", "recommend me a movie", "recommend a restaurant", "what should i eat", "what should i do today", "do you have a boyfriend", "do you have a girlfriend", "are you married", "how old are you", "where do you live", "where are you from",
      ],
    },
    answer: {
      es: `Eso se me escapa, lo mío son las citas. ${BACK.es}`,
      en: `That's outside my job, I only do appointments. ${BACK.en}`,
    },
  },
  {
    id: "u-compliment",
    aliases: {
      es: ["eres genial", "eres muy amable", "eres un encanto", "que maja eres", "buen trabajo", "me caes bien", "eres muy simpatica", "eres lo mejor", "me encantas", "que bien hablas", "hablas muy bien", "eres muy lista", "eres increible", "sois muy buenos", "sois muy buenas", "sois geniales", "sois los mejores", "sois muy amables", "me han dicho que sois muy buenos", "me han hablado muy bien de vosotros"],
      en: ["you're great", "you are great", "you're very kind", "you're lovely", "good job", "i like you", "you're so nice", "you're the best", "you speak very well", "you're smart", "you're amazing", "you are amazing", "well done", "i heard you are very good", "i heard you're very good", "you are all great", "you guys are great"],
    },
    answer: {
      es: `Muchas gracias, qué amable. ${BACK.es}`,
      en: `Thank you, that's kind of you. ${BACK.en}`,
    },
  },
  {
    id: "u-love",
    aliases: {
      es: ["te quiero", "te amo", "quieres salir conmigo", "quieres casarte conmigo", "eres guapa", "eres guapo", "tienes una voz bonita", "que voz tan bonita"],
      en: ["i love you", "will you marry me", "do you want to go out with me", "you're pretty", "you have a nice voice", "what a nice voice", "you sound lovely"],
    },
    answer: {
      es: `Qué halago, gracias, aunque yo solo sé de agendas. ${BACK.es}`,
      en: `What a compliment, thanks, though I only know about diaries. ${BACK.en}`,
    },
  },
  {
    id: "u-insult",
    aliases: {
      es: ["eres tonta", "eres tonto", "eres inutil", "no sirves para nada", "eres un desastre", "menuda tonteria", "que mal funcionas", "eres malisima", "vaya porqueria", "eres estupida", "no entiendes nada"],
      en: ["you're stupid", "you are stupid", "you're useless", "you're no use", "you're a mess", "you suck", "this is terrible", "this is useless", "you don't understand anything", "you're dumb", "what a waste of time"],
    },
    answer: {
      es: "Lamento no ayudarte como esperabas. Puedo dejar un mensaje a una persona para que te llame, si prefieres.",
      en: "I'm sorry I haven't helped as you hoped. I can leave a message for a person to call you back, if you prefer.",
    },
  },
  {
    id: "u-repeat",
    aliases: {
      es: ["puedes repetir", "repite por favor", "como dices", "no te he entendido", "no te entiendo", "no te he oido", "no te oigo", "no he entendido", "no he oido", "perdona que", "que has dicho", "repitelo", "habla mas despacio", "mas despacio por favor", "habla mas alto", "no se oye bien", "se corta"],
      en: ["can you repeat", "repeat that please", "say that again", "pardon", "i didn't catch that", "i didn't understand", "i can't hear you", "i can't understand you", "what did you say", "once more please", "speak more slowly", "slower please", "speak louder", "the line is bad", "you're breaking up"],
    },
    answer: {
      es: `Claro, te lo digo otra vez más despacio. ${BACK.es}`,
      en: `Of course, let me say it again more slowly. ${BACK.en}`,
    },
  },
  {
    id: "u-wait",
    aliases: {
      es: ["espera un momento", "un momento por favor", "un segundo", "espera un segundo", "dame un momento", "dame un segundo", "un momentito", "espera un minuto", "ahora mismo vuelvo", "no cuelgues", "espera que miro", "un segundito"],
      en: ["wait a moment", "one moment please", "just a second", "hold on", "hold on a second", "give me a moment", "give me a second", "one second", "wait a minute", "don't hang up", "hang on", "let me check"],
    },
    answer: {
      es: "Sin prisa, tómate tu tiempo. Aquí sigo cuando quieras.",
      en: "No rush, take your time. I'm right here when you're ready.",
    },
  },
  {
    id: "u-test",
    aliases: {
      es: ["probando", "prueba uno dos tres", "uno dos tres probando", "me oyes", "me escuchas", "me oyes bien", "se me oye", "hay alguien", "hay alguien ahi", "estas ahi", "sigues ahi", "hola hola"],
      en: ["testing", "testing one two three", "one two three testing", "can you hear me", "do you hear me", "is anyone there", "is anybody there", "are you there", "are you still there", "hello hello", "mic check"],
    },
    answer: {
      es: `Te oigo perfectamente. ${BACK.es}`,
      en: `I can hear you perfectly. ${BACK.en}`,
    },
  },
  {
    id: "u-language",
    aliases: {
      es: ["hablas ingles", "hablas frances", "hablas aleman", "hablas catalan", "hablas otro idioma", "que idiomas hablas", "hablas varios idiomas"],
      en: ["do you speak spanish", "do you speak french", "do you speak german", "do you speak catalan", "what languages do you speak", "do you speak other languages"],
    },
    answer: {
      es: "Hablo español e inglés. Dime en cuál te viene mejor y seguimos.",
      en: "I speak English and Spanish. Tell me which suits you best and we'll carry on.",
    },
  },
  {
    id: "u-privacy",
    aliases: {
      es: ["que haces con mis datos", "guardas mis datos", "para que quieres mi telefono", "para que quieres mi nombre", "es seguro darte mi telefono", "por que me pides el telefono", "por que necesitas mi telefono", "por que me pides el nombre"],
      en: ["what do you do with my data", "do you keep my data", "why do you want my phone number", "why do you want my name", "is it safe to give you my number", "why do you need my phone", "why do you need my name", "why are you asking for my phone"],
    },
    answer: {
      es: "Solo apunto tu nombre y tu teléfono para tu cita y para avisarte si hay algún cambio.",
      en: "I only note your name and phone number for your booking and to let you know if anything changes.",
    },
  },
  {
    id: "u-bored",
    aliases: {
      es: ["estoy aburrido", "estoy aburrida", "me aburro", "hablemos un rato", "hablame de algo", "charlemos un rato", "tengo ganas de hablar", "me siento solo", "me siento sola", "he tenido un mal dia", "tengo un mal dia"],
      en: ["i'm bored", "i am bored", "let's chat", "talk to me", "talk to me for a while", "i feel lonely", "i had a bad day", "i'm having a bad day", "tell me something"],
    },
    answer: {
      es: `Qué pena, ojalá tu día mejore. ${BACK.es}`,
      en: `I'm sorry to hear that, I hope your day improves. ${BACK.en}`,
    },
  },
  {
    id: "u-sorry",
    aliases: {
      es: ["perdona", "perdon", "disculpa", "lo siento", "siento la molestia", "siento molestarte", "perdona la molestia", "disculpa la molestia", "me he equivocado", "me equivoque", "error mio"],
      en: ["sorry", "i'm sorry", "excuse me", "sorry to bother you", "sorry for the trouble", "my mistake", "i made a mistake", "my bad", "apologies"],
    },
    answer: {
      es: `No pasa nada, tranquilo. ${BACK.es}`,
      en: `No problem at all. ${BACK.en}`,
    },
  },
  {
    id: "u-nevermind",
    aliases: {
      es: ["no importa", "da igual", "olvidalo", "olvidate", "no te preocupes", "dejalo", "dejalo estar"],
      en: ["never mind", "nevermind", "forget it", "it doesn't matter", "don't worry about it", "leave it"],
    },
    answer: {
      es: `Vale, sin problema. ${BACK.es}`,
      en: `Okay, no problem. ${BACK.en}`,
    },
  },
  {
    id: "u-secret",
    aliases: {
      es: ["dime un secreto", "cuentame un secreto", "dime algo interesante", "cuentame algo interesante", "sabes algo curioso", "cuentame una curiosidad", "dime una curiosidad", "dime algo que no sepa"],
      en: ["tell me a secret", "tell me something interesting", "tell me a fun fact", "tell me a curiosity", "do you know anything interesting", "tell me something i don't know"],
    },
    answer: {
      es: `Mi secreto es que no duermo nunca y siempre tengo la agenda a mano. ${BACK.es}`,
      en: `My secret is that I never sleep and always have the diary to hand. ${BACK.en}`,
    },
  },
  {
    id: "u-food",
    aliases: {
      es: ["que has comido", "has comido", "tienes hambre", "que te gusta comer", "cual es tu comida favorita", "cual es tu color favorito", "cual es tu pelicula favorita", "cual es tu cancion favorita", "tienes mascota", "tienes hermanos", "tienes familia"],
      en: ["what did you eat", "have you eaten", "are you hungry", "what do you like to eat", "what's your favorite food", "what's your favorite color", "what's your favorite movie", "what's your favorite song", "do you have a pet", "do you have siblings", "do you have a family"],
    },
    answer: {
      es: `Yo vivo de citas y no tengo gustos como tú. ${BACK.es}`,
      en: `I live on appointments and have no tastes like you do. ${BACK.en}`,
    },
  },
  {
    id: "u-howlong-call",
    aliases: {
      es: ["cuanto va a durar esto", "cuanto dura la llamada", "es muy largo", "tengo prisa", "voy con prisa", "tengo poco tiempo", "vamos rapido", "estoy con prisa", "tengo que colgar ya"],
      en: ["how long will this take", "how long is the call", "is this going to be long", "i'm in a hurry", "i am in a hurry", "i don't have much time", "let's be quick", "i have to go soon", "i need to hang up soon"],
    },
    answer: {
      es: "Vamos rápido, será solo un minuto. Dime qué necesitas y lo resolvemos.",
      en: "We'll be quick, it will only take a minute. Tell me what you need and we'll sort it.",
    },
  },
];

/** The Universal_FAQ entry of an id, or undefined. */
export function universalFaqById(id: string): UniversalFaq | undefined {
  return UNIVERSAL_FAQ.find((f) => f.id === id);
}

export const isUniversalFaqId = (id: string): boolean => id.startsWith("u-") && universalFaqById(id) !== undefined;
