// @ts-nocheck

/* eslint-disable jsx-a11y/alt-text */
/* eslint-disable @next/next/no-img-element */
import 'server-only'

import {
  createAI,
  createStreamableUI,
  getMutableAIState,
  getAIState,
  createStreamableValue
} from 'ai/rsc'

import { BotCard, BotMessage } from '@/components/stocks'

import { nanoid, sleep } from '@/lib/utils'
import { saveChat } from '@/app/actions'
import { SpinnerMessage, UserMessage } from '@/components/stocks/message'
import { Chat } from '../types'
import { auth } from '@/auth'
import { CheckIcon, SpinnerIcon } from '@/components/ui/icons'
import { format } from 'date-fns'
import { experimental_streamText } from 'ai'
import { google } from 'ai/google'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { z } from 'zod'

const genAI = new GoogleGenerativeAI(
  process.env.GOOGLE_GENERATIVE_AI_API_KEY || ''
)

async function describeImage(imageBase64: string) {
  'use server'

  const aiState = getMutableAIState()
  const spinnerStream = createStreamableUI(null)
  const messageStream = createStreamableUI(null)
  const uiStream = createStreamableUI()

  // Update UI to show spinner
  spinnerStream.update(<SpinnerMessage />);

  (async () => {
    try {
      let text = '';

      if (imageBase64 === '') {
        // Simulate processing delay for empty image
        await new Promise(resolve => setTimeout(resolve, 5000));

        text = `
          The books in this image are:
          1. The Little Prince by Antoine de Saint-Exupéry
          2. The Prophet by Kahlil Gibran
          3. Man's Search for Meaning by Viktor Frankl
          4. The Alchemist by Paulo Coelho
          5. The Kite Runner by Khaled Hosseini
          6. To Kill a Mockingbird by Harper Lee
          7. The Catcher in the Rye by J.D. Salinger
          8. The Great Gatsby by F. Scott Fitzgerald
          9. 1984 by George Orwell
          10. Animal Farm by George Orwell
        `;
      } else {
        const imageData = imageBase64.split(',')[1];

        const model = genAI.getGenerativeModel({ model: 'gemini-pro-vision' });
        const prompt = 'List the books in this image.';
        const image = {
          inlineData: {
            data: imageData,
            mimeType: 'image/png'
          }
        };

        const result = await model.generateContent([prompt, image]);
        text = result.response.text();
        console.log(text);
      }

      spinnerStream.done(null); // Hide spinner
      messageStream.done(null);

      // Update UI to show message
      uiStream.update(
        <BotCard>
          <BotMessage content={text} />
        </BotCard>
      );

      aiState.done({
        ...aiState.get(),
        interactions: [text]
      });
    } catch (e) {
      console.error(e);

      const error = new Error(
        'The AI encountered an error, please try again later.'
      );
      uiStream.error(error);
      spinnerStream.error(error);
      messageStream.error(error);
      aiState.done();
    }
  })();

  return {
    id: nanoid(),
    attachments: uiStream.value,
    spinner: spinnerStream.value,
    display: messageStream.value
  };
}

async function submitUserMessage(content: string) {
  'use server'

  const aiState = getMutableAIState()

  aiState.update({
    ...aiState.get(),
    messages: [
      ...aiState.get().messages,
      {
        id: nanoid(),
        role: 'user',
        content: `${aiState.get().interactions.join('\n\n')}\n\n${content}`
      }
    ]
  })

  const history = aiState.get().messages.map(message => ({
    role: message.role,
    content: message.content
  }))

  const textStream = createStreamableValue('')
  const spinnerStream = createStreamableUI(<SpinnerMessage />)
  const messageStream = createStreamableUI(null)
  const uiStream = createStreamableUI()

  (async () => {
    try {
      const result = await experimental_streamText({
        model: google.generativeAI('models/gemini-1.0-pro-001'),
        temperature: 0.7,
        system: `\
      You are a friendly assistant that helps the user with any queries, including generating code, answering questions, and providing information. 
      The date today is ${format(new Date(), 'd LLLL, yyyy')}.
      `,
        messages: [...history]
      })

      let textContent = ''
      spinnerStream.done(null)

      for await (const delta of result.fullStream) {
        const { type } = delta

        if (type === 'text-delta') {
          const { textDelta } = delta

          textContent += textDelta
          messageStream.update(<BotMessage content={textContent} />)

          aiState.update({
            ...aiState.get(),
            messages: [
              ...aiState.get().messages,
              {
                id: nanoid(),
                role: 'assistant',
                content: textContent
              }
            ]
          })
        }
      }

      uiStream.done()
      textStream.done()
      messageStream.done()
    } catch (e) {
      console.error(e)

      const error = new Error(
        'The AI encountered an error, please try again later.'
      )
      uiStream.error(error)
      textStream.error(error)
      messageStream.error(error)
      aiState.done()
    }
  })()

  return {
    id: nanoid(),
    attachments: uiStream.value,
    spinner: spinnerStream.value,
    display: messageStream.value
  }
}

export async function requestCode() {
  'use server'

  const aiState = getMutableAIState()

  aiState.done({
    ...aiState.get(),
    messages: [
      ...aiState.get().messages,
      {
        role: 'assistant',
        content:
          "A code has been sent to user's phone. They should enter it in the user interface to continue."
      }
    ]
  })

  const ui = createStreamableUI(
    <div className="animate-spin">
      <SpinnerIcon />
    </div>
  )

  ;(async () => {
    await sleep(2000)
    ui.done()
  })()

  return {
    status: 'requires_code',
    display: ui.value
  }
}

export async function validateCode() {
  'use server'

  const aiState = getMutableAIState()

  const status = createStreamableValue('in_progress')
  const ui = createStreamableUI(
    <div className="flex flex-col items-center justify-center gap-3 p-6 text-zinc-500">
      <div className="animate-spin">
        <SpinnerIcon />
      </div>
      <div className="text-sm text-zinc-500">
        Please wait while we fulfill your order.
      </div>
    </div>
  )

  ;(async () => {
    await sleep(2000)

    ui.done(
      <div className="flex flex-col items-center text-center justify-center gap-3 p-4 text-emerald-700">
        <CheckIcon />
        <div>Payment Succeeded</div>
        <div className="text-sm text-zinc-600">
          Thanks for your purchase! You will receive an email confirmation
          shortly.
        </div>
      </div>
    )

    aiState.done({
      ...aiState.get(),
      messages: [
        ...aiState.get().messages.slice(0, -1),
        {
          role: 'assistant',
          content: 'The purchase has completed successfully.'
        }
      ]
    })

    status.done('completed')
  })()

  return {
    status: status.value,
    display: ui.value
  }
}

export type Message = {
  role: 'user' | 'assistant' | 'system' | 'function' | 'data' | 'tool'
  content: string
  id?: string
  name?: string
  display?: {
    name: string
    props: Record<string, any>
  }
}

export type AIState = {
  chatId: string
  interactions?: string[]
  messages: Message[]
}

export type UIState = {
  id: string
  display: React.ReactNode
  spinner?: React.ReactNode
  attachments?: React.ReactNode
}[]

export const AI = createAI<AIState, UIState>({
  actions: {
    submitUserMessage,
    requestCode,
    validateCode,
    describeImage
  },
  initialUIState: [],
  initialAIState: { chatId: nanoid(), interactions: [], messages: [] },
  unstable_onGetUIState: async () => {
    'use server'

    const session = await auth()

    if (session && session.user) {
      const aiState = getAIState()

      if (aiState) {
        const uiState = getUIStateFromAIState(aiState)
        return uiState
      }
    } else {
      return
    }
  },
  unstable_onSetAIState: async ({ state }) => {
    'use server'

    const session = await auth()

    if (session && session.user) {
      const { chatId, interactions, messages } = state

      const chat: Chat = {
        id: chatId,
        userId: session.user.id,
        title: `${messages[0].content.slice(0, 20)}...`,
        createdAt: new Date(),
        interactions: interactions || [],
        messages
      }

      await saveChat(chat)
    }
  }
})

function getUIStateFromAIState(aiState: AIState): UIState {
  return aiState.messages.map(message => ({
    id: message.id!,
    display: message.display ? (
      <message.display.name {...message.display.props} />
    ) : (
      <BotMessage content={message.content} />
    )
  }))
}
