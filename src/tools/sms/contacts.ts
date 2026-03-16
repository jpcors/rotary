import { z } from "zod";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { log } from "../../lib/logger.js";

const CARRIER_GATEWAYS: Record<string, string> = {
  att: "txt.att.net",
  verizon: "vtext.com",
  tmobile: "tmomail.net",
  sprint: "messaging.sprintpcs.com",
  uscellular: "email.uscc.net",
  boost: "sms.myboostmobile.com",
  cricket: "sms.cricketwireless.net",
  metro: "mymetropcs.com",
};

export const contactSchema = z.object({
  name: z.string(),
  phone: z.string().regex(/^\d{10}$/, "Phone must be 10 digits"),
  carrier: z.string().refine(
    (c) => c.toLowerCase() in CARRIER_GATEWAYS,
    (c) => ({ message: `Unknown carrier "${c}". Known: ${Object.keys(CARRIER_GATEWAYS).join(", ")}` })
  ),
});

export type Contact = z.infer<typeof contactSchema>;

const contactsFileSchema = z.array(contactSchema);

export function getGatewayEmail(contact: Contact): string {
  const gateway = CARRIER_GATEWAYS[contact.carrier.toLowerCase()];
  return `${contact.phone}@${gateway}`;
}

export function loadContacts(): Contact[] {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const contactsPath = join(__dirname, "..", "..", "..", "contacts.json");

  try {
    const raw = readFileSync(contactsPath, "utf-8");
    const parsed = contactsFileSchema.parse(JSON.parse(raw));
    log(`Loaded ${parsed.length} contacts`);
    return parsed;
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      log("No contacts.json found, SMS tool will have no contacts");
      return [];
    }
    throw err;
  }
}
