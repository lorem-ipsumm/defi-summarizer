import * as dotenv from "dotenv";
dotenv.config();
import * as readline from "readline";
import { Configuration, OpenAIApi } from "openai";
import axios from "axios";
import cheerio from "cheerio";
import Twitter from "twitter-lite";
import {
  TweetV2PostTweetResult,
  TwitterApi,
  TwitterApiReadWrite,
} from "twitter-api-v2";

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
  output: process.stdout,
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
};

// extract tweets from HTML
const extractTweets = (content: string): string[] => {
  const $ = cheerio.load(content);
  const tweetUrls: string[] = [];

  $('a[href*="https://twitter.com"]').each((_index, element) => {
    const tweetUrl = $(element).attr("href");
    if (tweetUrl && !tweetUrls.includes(tweetUrl)) {
      tweetUrls.push(tweetUrl);
    }
  });

  return tweetUrls;
};

const getThread = async (
  id: string
): Promise<{ thread: string; conversationId: string }> => {
  // setup twitter client
  const client = new TwitterApi({
    appKey: process.env.APP_KEY as string,
    appSecret: process.env.APP_SECRET as string,
    accessToken: process.env.ACCESS_TOKEN as string,
    accessSecret: process.env.ACCESS_SECRET as string,
  });
  const bearer = new TwitterApi(process.env.BEARER_TOKEN as string);
  // enable read permissions using bearer token
  // const readOnly = bearer.readOnly;
  // enable read and write permissions
  const twitter = client.readWrite;

  const errorResponse = {
    thread: "",
    conversationId: "N/A",
  };

  try {
    // get some data from the tweet that was replied to
    const mentionedTweet = await twitter.v2.tweets(id, {
      "user.fields": "name",
      "tweet.fields": ["conversation_id"],
    });

    // grab the conversation id from the tweet
    const conversation_id = mentionedTweet.data[0].conversation_id as string;

    // get first tweet and the author
    const firstTweet = await twitter.v1.tweets([conversation_id]);
    const user = firstTweet[0].user.screen_name;

    // get all tweets that are in this conversation and include author
    const search = await twitter.v2.search(
      `conversation_id: ${conversation_id} from: ${user} to: ${user}`,
      { query: "sort_order: recency" }
    );
    const resultCount = search.data.meta.result_count;

    // collect tweets in an array and reverse the order
    const tweets = search.data.data;
    let threadText: any[] = [];
    if (resultCount > 0) threadText = tweets.map((tweet) => tweet.text);
    threadText.push(firstTweet[0].full_text as string);
    threadText.reverse();

    let fullText = "";

    // build text
    for (const tweet of threadText) {
      fullText += `${tweet}\n`;
    }

    // generate the summary
    // const summary = await generateSummary(fullText);
    // console.log(summary);
    return {
      thread: fullText,
      conversationId: conversation_id,
    };
  } catch (e) {
    console.log(e);
    return errorResponse;
  }
};

// extract the text from a tweet
const fetchTweetText = async (url: string): Promise<string> => {
  const tweetId = url.split("/").pop();
  try {
    const tweet = await twitterClient.get("statuses/show", {
      id: tweetId?.toString(),
    });
    return tweet.text;
  } catch (e) {
    // console.log(`tweetId: " failed (${url})`);
    return "";
  }
};

let context = "";

// get user input
const getInput = async (prompt: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer);
    });
  });
};

// send a prompt to the openAI API
const sendPrompt = async (prompt: string): Promise<string> => {
  try {
    const completion = await openai.createChatCompletion({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: `You are a helpful Defi-Newsletter reading assistant. The following text includes our conversation up to this point: ${context}`,
        },
        { role: "user", content: `${prompt}` },
      ],
    });

    const choices = completion.data.choices;
    const res = choices[0].message;
    if (res) return res.content;
    else return "";
  } catch (e) {
    console.log(e);
    console.log("Failed to generate response");
    return "";
  }
};

// setup initial context with instructions
const getNewsletterContent = async () => {
  const newsletterUrl = await getInput("Newsletter URL: ");
  const content = await fetchNewsletterContent(newsletterUrl);

  const tweetUrls = extractTweets(content);
  const tweetTexts = await Promise.all(tweetUrls.map(fetchTweetText));

  const combinedText = tweetTexts.join("\n\n");
  const prompt = `
    The following text is from a DeFi newsletter that covers recent defi news, 
    new project launches, braoder finance news, etc. I read these every day in 
    order to find potential profitable opportunities. I generally look for arbitrage
    opportunities or protocol mechanics that can be cleverly used for profit. 
    Please read the content and answer my questions to help me find profitable strategies: ${combinedText}.
    Please refer to the content of the newseletter when responding to my questions.`;

  context += `${prompt}\n`;
};

const threadRequest = async (tweetId: string) => {
  const thread = await (await getThread(tweetId)).thread;
  context += `${thread}\n}`;
  const res = await sendPrompt(
    `Please digest this content and wait for my next question. If you understand respond with "Ready": ${thread}`
  );
  console.log(`${"[GPT-4]: " + res}}`);
};

const main = async () => {
  await getNewsletterContent();
  console.log("Newsletter content loaded. Generating a bullet pointed list");
  const firstPrompt = `Please write a bullet pointed list of the most important things you learned from the newsletter. Provide a link to each tweet that you are referencing.`;
  const firstResponse = await sendPrompt(firstPrompt);
  console.log(firstResponse);
  while (true) {
    const userInput = await getInput("[you]  : ");
    if (
      userInput.toLowerCase() === "exit" ||
      userInput.toLowerCase() === "quit"
    ) {
      break;
    } else if (!isNaN(Number(userInput))) {
      await threadRequest(userInput);
      continue;
    }
    context += `\n[you]  : ${userInput}`;
    // const formattedInput = formatText(userInput);
    const response = await sendPrompt(userInput);
    context += `\n[GPT-4]: ${response}`;
    console.log(`${"[GPT-4]"}: ${response}`);
  }
  rl.close();
};

main().catch((error) => {
  console.error("An error occurred:", error);
});
