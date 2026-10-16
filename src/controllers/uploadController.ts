import { Response } from "express";
import { AuthRequest } from "../middlewares/authorize.middleware";
import cloudinary from "../utils/cloudinary";
import { config } from "../configs/envConfig";
import sendResponse from "../utils/reponse";
import { v4 as uuidv4 } from 'uuid';

export const getUploadSignature = async (req: AuthRequest, res: Response) => {
    try {
        const type = (req.query.type || req.query.folder) as string;
        const { userId } = req.user || {};

        if (!userId) {
            return sendResponse(res, 401, false, "Unauthorized");
        }

        const timestamp = Math.round(new Date().getTime() / 1000);

        let folderName = 'general';
        const normalizedType = type?.toLowerCase().trim();

        switch (normalizedType) {
            case 'image':
            case 'images':
            case 'photo':
            case 'photos':
            case 'kyc':
            case 'doc':
            case 'document':
            case 'documents':
                folderName = 'kyc_documents';
                break;
            case 'avatar':
            case 'avatars':
                folderName = 'avatars';
                break;
            case 'frame':
            case 'frames':
                folderName = 'frames';
                break;
            case 'entry':
            case 'entries':
                folderName = 'entries';
                break;
            case 'store':
                folderName = 'store_assets';
                break;
            case 'help':
                folderName = 'help_support';
                break;
            case 'chat':
                folderName = 'chat_media';
                break;
            case 'host':
            case 'hosts':
                folderName = 'hosts';
                break;
            case 'banner':
            case 'banners':
                folderName = 'banners';
                break;
            case 'raw':
            case 'audio':
            case 'voice':
            case 'video':
            case 'file':
                folderName = 'voice_recordings';
                break;
            default:
                return sendResponse(res, 400, false, `Invalid upload type: ${type}. Allowed: kyc, avatar, frame, entry, store, help, chat, host, banner, raw, audio, voice, doc`);
        }

        const uniqueSuffix = uuidv4().split('-')[0];
        const public_id = `${userId}_${normalizedType}_${timestamp}_${uniqueSuffix}`;

        const paramsToSign = {
            timestamp,
            folder: folderName,
            public_id: public_id,
        };

        const signature = cloudinary.utils.api_sign_request(
            paramsToSign,
            config.CLOUDINARY_API_SECRET!
        );

        return sendResponse(res, 200, true, "Signature generated successfully", {
            signature,
            timestamp,
            cloud_name: config.CLOUDINARY_CLOUD_NAME,
            api_key: config.CLOUDINARY_API_KEY,
            folder: folderName,
            public_id: public_id
        });
    } catch (error: any) {
        return sendResponse(res, 500, false, error.message || "Failed to generate signature");
    }
};

/**
 * Direct file upload handler for gift icons, animations (.svga, .gif, .webp, .png) and admin assets.
 */
export const uploadDirectFile = async (req: AuthRequest, res: Response) => {
  try {
    const file = req.file;
    if (!file) {
      return sendResponse(res, 400, false, "No file uploaded");
    }

    const host = req.get("host") || "api.yaroapp.in";
    const protocol = req.protocol === "https" || req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
    const fileUrl = `${protocol}://${host}/uploads/gifts/${file.filename}`;

    return sendResponse(res, 200, true, "File uploaded successfully", {
      url: fileUrl,
      filename: file.filename,
      size: file.size,
      mimetype: file.mimetype,
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || "Failed to upload file");
  }
};

export const uploadRoomCover = async (req: AuthRequest, res: Response) => {
  try {
    const file = req.file;
    if (!file) return sendResponse(res, 400, false, "No room DP selected");

    const forwardedHost = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
    const host = forwardedHost || req.get("host") || "api.yaroapp.in";
    const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
    const protocol = req.protocol === "https" || forwardedProto === "https" ? "https" : "http";
    const url = `${protocol}://${host}/uploads/rooms/${file.filename}`;
    return sendResponse(res, 200, true, "Room DP uploaded successfully", { url, filename: file.filename });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || "Failed to upload room DP");
  }
};

export const analyzeAssetName = async (req: AuthRequest, res: Response) => {
  const file = req.file;
  if (!file) return sendResponse(res, 400, false, "Choose an image to analyze");

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return sendResponse(res, 503, false, "AI naming is not configured on the server (OPENAI_API_KEY is missing)");
  }

  try {
    const assetType = String(req.body?.assetType || "digital asset").trim().slice(0, 60);
    const model = process.env.OPENAI_ASSET_NAME_MODEL || "gpt-4.1-mini";
    const imageDataUrl = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        model,
        store: false,
        max_output_tokens: 80,
        input: [{
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Analyze this ${assetType} image. Suggest one polished, memorable product name based on its visible colors, shapes, and theme. Return only the name, 2 to 4 words, without quotes, emojis, numbering, or a file extension.`,
            },
            { type: "input_image", image_url: imageDataUrl, detail: "low" },
          ],
        }],
      }),
    });

    const payload: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.warn("Asset name AI provider returned an error:", response.status, payload?.error?.code || "provider_error");
      return sendResponse(res, 502, false, "AI could not analyze this image. You can enter the name manually.");
    }

    const outputText = typeof payload.output_text === "string"
      ? payload.output_text
      : (payload.output || [])
        .flatMap((item: any) => Array.isArray(item.content) ? item.content : [])
        .find((part: any) => part.type === "output_text")?.text;
    const name = String(outputText || "")
      .replace(/^[\s"'`]+|[\s"'`]+$/g, "")
      .replace(/[.!?]+$/g, "")
      .split(/\s+/)
      .slice(0, 5)
      .join(" ")
      .slice(0, 48);

    if (!name) return sendResponse(res, 502, false, "AI did not return a usable name");
    return sendResponse(res, 200, true, "Asset name suggested", { name });
  } catch (error: any) {
    console.error("analyzeAssetName error:", error?.message || error);
    return sendResponse(res, 502, false, "AI name suggestion failed. You can enter the name manually.");
  }
};
