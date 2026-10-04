import { NextRequest, NextResponse } from "next/server";
import {GoogleGenAI, ThinkingLevel} from '@google/genai'
import { buildAgentConfigPrompt } from "@/prompt";
import { AgentConfigRespSchema } from "@/AgentConfigRespSchema";

export async function POST(req:NextRequest){
    const body = await req.json();
    const prompt = body?.prompt;
    const answers = body?.answers;
    if(typeof prompt !== "string" || !prompt.trim()){
        return NextResponse.json({error:'Prompt is Required'}, { status: 400 })
    }
    const apiKey=process.env.GOOGLE_CLOUD_GEMINI_API_KEY;


    try{
   const ai=new GoogleGenAI({apiKey});

   const response=await ai.models.generateContent({
    model:'gemini-3.5-flash-lite',
    contents: buildAgentConfigPrompt(prompt.trim(), answers),
    config:{
        thinkingConfig:{thinkingLevel:ThinkingLevel.MEDIUM},
        responseMimeType:'application/json',
        responseSchema:AgentConfigRespSchema
    }
   })
   return NextResponse.json(JSON.parse(response.text??"{}"))
    } 
    catch(e){
       console.error("Gemini agent configuration failed:", e)
       const apiError = e as { status?: number; message?: string }
       if (apiError.status === 503 || apiError.status === 429) {
         return NextResponse.json(
           { error: "Gemini is temporarily busy. Please try again in a moment." },
           { status: apiError.status },
         )
       }
       return NextResponse.json(
         { error: "Unable to generate the agent configuration. Please try again." },
         { status: 500 },
       )
    }

}
