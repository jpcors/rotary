import { createTransport } from "nodemailer";
import { Type } from "@google/genai";
import { env } from "../../lib/config.js";
import { log, logError } from "../../lib/logger.js";
import { loadContacts, getGatewayEmail, type Contact } from "./contacts.js";
import type { Tool } from "../types.js";

let contacts: Contact[] = [];

function findContact(name: string): Contact | undefined {
  const lower = name.toLowerCase();
  return contacts.find((c) => c.name.toLowerCase() === lower);
}

function getContactNames(): string {
  return contacts.map((c) => c.name).join(", ");
}

export function createSmsTool(): Tool | null {
  if (!env.SMTP_USER || !env.SMTP_PASS) {
    log("SMS tool disabled: SMTP_USER and SMTP_PASS not set");
    return null;
  }

  contacts = loadContacts();
  if (contacts.length === 0) {
    log("SMS tool disabled: no contacts configured");
    return null;
  }

  const transporter = createTransport({
    service: "gmail",
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  });

  return {
    declaration: {
      name: "send_text_message",
      description:
        `Send a text message (SMS) to a contact. ` +
        `Available contacts: ${getContactNames()}. ` +
        `Messages should be concise (under 160 characters). ` +
        `Always confirm the recipient and message with the caller before sending.`,
      parameters: {
        type: Type.OBJECT,
        properties: {
          recipient: {
            type: Type.STRING,
            description: `The name of the contact to text. Must be one of: ${getContactNames()}`,
          },
          message: {
            type: Type.STRING,
            description: "The text message to send. Keep under 160 characters.",
          },
        },
        required: ["recipient", "message"],
      },
    },

    handler: async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const recipient = args.recipient as string;
      const message = args.message as string;

      const contact = findContact(recipient);
      if (!contact) {
        return {
          success: false,
          error: `No contact named "${recipient}". Available contacts: ${getContactNames()}`,
        };
      }

      if (message.length > 160) {
        return {
          success: false,
          error: `Message is ${message.length} characters. SMS limit is 160. Please shorten it.`,
        };
      }

      const gatewayEmail = getGatewayEmail(contact);
      log(`Sending SMS to ${contact.name} via ${gatewayEmail}`);

      try {
        await transporter.sendMail({
          from: env.SMTP_USER,
          to: gatewayEmail,
          subject: "",
          text: message,
        });

        log(`SMS sent to ${contact.name}`);
        return {
          success: true,
          message: `Text message sent to ${contact.name}`,
        };
      } catch (err: any) {
        logError(`SMS send failed: ${err.message}`);
        return {
          success: false,
          error: `Failed to send text: ${err.message}`,
        };
      }
    },
  };
}
