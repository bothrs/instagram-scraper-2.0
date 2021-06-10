import * as dotenv from "dotenv";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import logger from "morgan";
import Airtable from "airtable";
import puppeteer from "puppeteer";
import delay from "delay";
import { removeParams } from "./utils";

// SETUP EXPRESS 🚀
dotenv.config();
const app = express();
app.use(express.json());
app.use(cors());
app.use(logger("dev"));

// SETUP DATABASE 🥎
var base = new Airtable({ apiKey: process.env.AIRTABLE_KEY }).base(
  process.env.AIRTABLE_APP
);
const user = {
  username: process.env.INSTAGRAM_USER,
  password: process.env.INSTAGRAM_PASSWORD,
};
// ROUTES 🛣
app.get("/", async (req: Request, res: Response) => {
  const instagramURL = "https://www.instagram.com/";
  let links;
  try {
    // GET PROFILES
    const profilesRaw = await base("profiles").select().all();

    const profiles = profilesRaw
      .map((x) => x.fields)
      .map((x: { Name?: string }) => x.Name)
      .filter((x) => x);

    // START PUPPETEER
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/74.0.3683.103 Safari/537.36"
    );

    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9",
    });

    // LOGIN INSTAGRAM
    const loginUrl = "https://www.instagram.com/accounts/login/";
    await page.goto(loginUrl);

    if (page.url() === loginUrl) {
      const [accept] = await page.$x('//button[contains(.,"Accept")]');
      if (accept) {
        await accept.click({ delay: 30 });
      }
      await page.waitFor("input[name=username]", { visible: true });
      await delay(100);
      await page.type("input[name=username]", user.username, {
        delay: 50,
      });

      await delay(100);
      await page.type("input[name=password]", user.password, { delay: 50 });

      await delay(100);
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Enter");
    }
    await delay(5000);

    // GO TO PROFILE PAGES
    for (let index = 0; index < profiles.length; index++) {
      const profile = profiles[index];

      await page.goto(instagramURL + profile);

      links = await page.evaluate(() => {
        return Array.from(
          document.querySelectorAll("main article a div img")
        ).map((anchor: HTMLImageElement) => anchor.src);
      });

      console.log(links);
      // SAVE TO DB
      links.forEach(async (linkie) => {
        if (!linkie.includes("www.instagram.com")) {
          const results = await base("instagramz")
            .select({
              filterByFormula: `{ImageUrlWithoutParams} = "${removeParams(
                linkie
              )}"`,
            })
            .all();
          if (!results.length) {
            await base("instagramz").create([
              {
                fields: {
                  Name: profile,
                  Images: [{ url: linkie }],
                  ImageUrlWithoutParams: removeParams(linkie),
                },
              },
            ]);
          }
        }
      });
    }

    //CLOSE BROWSER
    await browser.close();
  } catch (error) {
    console.error(error);
    return res.json({ error });
  }

  res.json(links);
});

app.get("/pictures/:user", async (req: Request, res: Response) => {
  const user = req.params.user;
  const results = await base("instagramz")
    .select({
      filterByFormula: `{Name} = "${user}"`,
    })
    .all();

  res.json({ user, results: (results || []).map((x) => x.fields) });
});

app.post("/profiles", async (req: Request, res: Response) => {
  const profileName = req.body.name;

  const results = await base("profiles")
    .select({
      filterByFormula: `{Name} = "${profileName}"`,
    })
    .all();

  if (results.length > 0) {
    return res.status(406).send("Profile is already added");
  }

  await base("profiles").create([{ fields: { Name: profileName } }]);
  res.status(201).send("Added profile");
});

app.get("/test", async (req: Request, res: Response) => {
  res.json("test");
});

app.listen(process.env.PORT, () => {
  console.log("Your app is listening on port " + process.env.PORT);
});
