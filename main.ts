import * as dotenv from 'dotenv';
dotenv.config();
import * as readline from 'readline';
import { Configuration, OpenAIApi  } from 'openai';
import axios from 'axios';
import cheerio from 'cheerio';
import Twitter from 'twitter-lite';

// const consoleWidth = process.stdout.columns || 80;
// const wrapWidth = consoleWidth - 4;

// initialize openAI API
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// initialize readline
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// initialize twitter client
const twitterClient = new Twitter({
  consumer_key: process.env.APP_KEY as string,
  consumer_secret: process.env.APP_SECRET as string,
  access_token_key: process.env.ACCESS_TOKEN as string,
  access_token_secret: process.env.ACCESS_SECRET as string,
});


// make get request to get newsletter HTML
const fetchNewsletterContent = async (url: string): Promise<string> => {
  const response = await axios.get(url);
  return response.data;
}

// extract tweets from HTML
const extractTweets = (content: string): string[] => {
  const $ = cheerio.load(content);
  const tweetUrls: string[] = [];

  $('a[href*="https://twitter.com"]').each((_index, element) => {
    const tweetUrl = $(element).attr('href');
    if (tweetUrl && !tweetUrls.includes(tweetUrl)) {
      tweetUrls.push(tweetUrl);
    }
  });

  return tweetUrls;
}

// extract the text from a tweet
const fetchTweetText = async(url: string): Promise<string> => {
  const tweetId = url.split('/').pop();
  try {
    const tweet = await twitterClient.get('statuses/show', { id: tweetId?.toString() });
    return tweet.text;
  } catch (e) {
    // console.log(`tweetId: " failed (${url})`);
    return "";
  }
}

let context = "";

// get user input
const getInput = async (prompt: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer);
    });
  });
}

// send a prompt to the openAI API
const sendPrompt = async (prompt: string):Promise<string> => { 
  try {
    const completion = await openai.createChatCompletion({
      model: "gpt-4",
      messages: [
        {"role": "system", "content": `You are a helpful Defi-Newsletter reading assistant. The following text includes our conversation up to this point: ${context}`},
        {"role": "user", "content": `${prompt}`}
      ],
    });

    const choices = completion.data.choices;
    const res = choices[0].message;
    if (res)
      return res.content;
    else return "";
  } catch (e) {
    console.log(e);
    console.log("Failed to generate response");
    return "";
  }
}

// setup initial context with instructions
const getNewsletterContent = async () => {

  const newsletterUrl = await getInput("Newsletter URL: ");
  const content = await fetchNewsletterContent(newsletterUrl);

  const tweetUrls = extractTweets(content);
  const tweetTexts = await Promise.all(tweetUrls.map(fetchTweetText));

  const combinedText = tweetTexts.join('\n\n');
  const prompt = `
    The following text is from a DeFi newsletter that covers recent defi news, 
    new project launches, braoder finance news, etc. I read these every day in 
    order to find potential profitable opportunities. I generally look for arbitrage
    opportunities or protocol mechanics that can be cleverly used for profit. 
    Please read the content and answer my questions to help me find profitable strategies: ${combinedText}.
    Please refer to the content of the newseletter when responding to my questions.`;

  context += `${prompt}\n`;
  console.log(`[GPT-4]: Ready`);
}

const main = async() => {
  await getNewsletterContent();
  while (true) {
    const userInput = await getInput("[you]  : ");
    if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === "quit") {
      break;
    }
    context += `\n[you]  : ${userInput}`;
    // const formattedInput = formatText(userInput);
    const response = await sendPrompt(userInput);
    context += `\n[GPT-4]: ${response}`;
    console.log(`${'[GPT-4]'}: ${(response)}`);
  }
  rl.close();
}

main().catch((error) => {
  console.error('An error occurred:', error);
});