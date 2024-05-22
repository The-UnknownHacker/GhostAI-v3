'use client'
import dynamic from 'next/dynamic'
import { useRef, useState, useMemo, KeyboardEvent, useEffect, useCallback, useLayoutEffect } from 'react'
import { EdgeSpeech, SpeechRecognition } from '@xiangfa/polly'
import SiriWave from 'siriwave'
import {
  Bot,
  AudioLines,
  Mic,
  MessageSquareText,
  Settings,
  Pause,
  SendHorizontal,
  Github,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import ThemeToggle from '@/components/ThemeToggle'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import MessageItem from '@/components/MessageItem'
import ErrorMessageItem from '@/components/ErrorMessageItem'
import SystemInstruction from '@/components/SystemInstruction'
import AttachmentArea from '@/components/AttachmentArea'
import Button from '@/components/Button'
import { useMessageStore } from '@/store/chat'
import { useAttachmentStore } from '@/store/attachment'
import { useSettingStore } from '@/store/setting'
import chat, { type RequestProps } from '@/utils/chat'
import { summarizePrompt, getVoiceModelPrompt, getSummaryPrompt } from '@/utils/prompt'
import AudioStream from '@/utils/AudioStream'
import PromiseQueue from '@/utils/PromiseQueue'
import textStream, { streamToText } from '@/utils/textStream'
import { encodeToken } from '@/utils/signature'
import { formatTime } from '@/utils/common'
import { cn } from '@/utils'
import { Model } from '@/constant/model'
import { customAlphabet } from 'nanoid'
import { isFunction } from 'lodash-es'

interface AnswerParams {
  messages: Message[]
  model: string
  onResponse: (readableStream: ReadableStream) => void
  onError?: (error: string, code?: number) => void
}

const buildMode = process.env.NEXT_PUBLIC_BUILD_MODE as string
const nanoid = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 8)

const AssistantRecommend = dynamic(() => import('@/components/AssistantRecommend'))
const Setting = dynamic(() => import('@/components/Setting'))
const FileUploader = dynamic(() => import('@/components/FileUploader'))

export default function Home() {
  const { t } = useTranslation()
  const siriWaveRef = useRef<HTMLDivElement>(null)
  const scrollAreaBottomRef = useRef<HTMLDivElement>(null)
  const audioStreamRef = useRef<AudioStream>()
  const edgeSpeechRef = useRef<EdgeSpeech>()
  const speechRecognitionRef = useRef<SpeechRecognition>()
  const speechQueue = useRef<PromiseQueue>()
  const messagesRef = useRef(useMessageStore.getState().messages)
  const messageStore = useMessageStore()
  const attachmentStore = useAttachmentStore()
  const settingStore = useSettingStore()
  const [textareaHeight, setTextareaHeight] = useState<number>(24)
  const [siriWave, setSiriWave] = useState<SiriWave>()
  const [content, setContent] = useState<string>('')
  const [subtitle, setSubtitle] = useState<string>('')
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [isRecording, setIsRecording] = useState<boolean>(false)
  const [recordTimer, setRecordTimer] = useState<NodeJS.Timeout>()
  const [recordTime, setRecordTime] = useState<number>(0)
  const [settingOpen, setSetingOpen] = useState<boolean>(false)
  const [speechSilence, setSpeechSilence] = useState<boolean>(false)
  const [disableSpeechRecognition, setDisableSpeechRecognition] = useState<boolean>(false)
  const [status, setStatus] = useState<'thinkng' | 'silence' | 'talking'>('silence')
  const statusText = useMemo(() => {
    switch (status) {
      case 'silence':
      case 'talking':
        return ''
      case 'thinkng':
      default:
        return t('status.thinking')
    }
  }, [status, t])
  const isVisionModel = useMemo(() => {
    return [Model['Gemini Pro Vision'], Model['Gemini 1.0 Pro Vision']].includes(settingStore.model as Model)
  }, [settingStore.model])
  const supportAttachment = useMemo(() => {
    return [
      Model['Gemini 1.5 Pro'],
      Model['Gemini 1.5 Flash'],
      Model['Gemini Pro Vision'],
      Model['Gemini 1.0 Pro Vision'],
    ].includes(settingStore.model as Model)
  }, [settingStore.model])
  const isUploading = useMemo(() => {
    for (const file of attachmentStore.files) {
      if (file.status === 'PROCESSING') return true
    }
    return false
  }, [attachmentStore.files])

  const speech = useCallback(
    (content: string) => {
      if (content.length === 0) return
      speechQueue.current?.enqueue(
        () =>
          new Promise(async (resolve, reject) => {
            if (speechSilence) reject(false)
            const { ttsVoice } = useSettingStore.getState()
            const voice = await edgeSpeechRef.current?.create({
              input: content,
              options: { voice: ttsVoice },
            })
            if (voice) {
              const { save: saveMessage } = useMessageStore.getState()
              const audio = await voice.arrayBuffer()
              setStatus('talking')
              const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent)
              siriWave?.setSpeed(isSafari ? 0.1 : 0.05)
              siriWave?.setAmplitude(2)
              audioStreamRef.current?.play({
                audioData: audio,
                text: content,
                onStart: (text) => {
                  setSubtitle(text)
                },
                onFinished: () => {
                  setStatus('silence')
                  saveMessage()
                  siriWave?.setSpeed(0.04)
                  siriWave?.setAmplitude(0.1)
                },
              })
              resolve(true)
            }
          }),
      )
    },
    [siriWave, speechSilence],
  )

  const scrollToBottom = useCallback(() => {
    scrollAreaBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  const fetchAnswer = useCallback(async ({ messages, model, onResponse, onError }: AnswerParams) => {
    const { systemInstruction } = useMessageStore.getState()
    const { apiKey, apiProxy, password } = useSettingStore.getState()
    setErrorMessage('')
    if (apiKey !== '') {
      const config: RequestProps = {
        messages,
        apiKey: apiKey,
        model,
      }
      if (apiProxy) config.baseUrl = apiProxy
      if (systemInstruction) config.systemInstruction = systemInstruction
      try {
        const result = await chat(config)
        const encoder = new TextEncoder()
        const readableStream = new ReadableStream({
          async start(controller) {
            try {
              for await (const chunk of result.stream) {
                const chunkText = chunk.text()
                controller.enqueue(encoder.encode(chunkText))
              }
            } catch (error) {
              if (error instanceof Error && isFunction(onError)) {
                onError(error.message)
              }
            }
            controller.close()
          },
        })
        onResponse(readableStream)
      } catch (error) {
        if (error instanceof Error && isFunction(onError)) {
          onError(error.message)
        }
      }
    } else {
      const token = encodeToken(password)
      const config: {
        messages: Message[]
        model: string
        systemInstruction?: string
      } = {
        messages,
        model,
      }
      if (systemInstruction) config.systemInstruction = systemInstruction
      const response = await fetch(`/api/chat?token=${token}`, {
        method: 'POST',
        body: JSON.stringify(config),
      })
      if (response.status < 400 && response.body) {
        onResponse(response.body)
      } else {
        if (response.headers.get('Content-Type') === 'text/html') {
          setSetingOpen(true)
        } else {
          const { message, code } = await response.json()
          if (isFunction(onError)) {
            onError(message, code)
          }
          if (code === 40302 || code === 50002) {
            setSetingOpen(true)
          }
        }
      }
    }
  }, [])

  const summarize = useCallback(
    async (messages: Message[]) => {
      const { summary, summarize: summarizeChat } = useMessageStore.getState()
      const { ids, prompt } = summarizePrompt(messages, summary.ids, summary.content)
      await fetchAnswer({
        messages: [{ id: 'summary', role: 'user', parts: [{ text: prompt }] }],
        model: Model['Gemini Pro'],
        onResponse: async (readableStream) => {
          const text = await streamToText(readableStream)
          summarizeChat(ids, text.trim())
        },
      })
    },
    [fetchAnswer],
  )

  const handleError = useCallback(async (message: string, code?: number) => {
    const messages = [...messagesRef.current]
    const lastMessage = messages.pop()
    if (lastMessage?.role === 'model') {
      const { revoke } = useMessageStore.getState()
      revoke(lastMessage.id)
      setStatus('silence')
      setErrorMessage(`${code ?? '400'}: ${message}`)
    }
  }, [])

  const handleResponse = useCallback(
    async (data: ReadableStream, currentMessage: Message) => {
      const { lang, talkMode, maxHistoryLength } = useSettingStore.getState()
      const { summary, update: updateMesssage, save: saveMessage } = useMessageStore.getState()
      speechQueue.current = new PromiseQueue()
      setSpeechSilence(false)
      let text = ''
      await textStream({
        readable: data,
        locale: lang,
        onMessage: (content) => {
          text += content
          updateMesssage(currentMessage.id, {
            id: currentMessage.id,
            role: 'model',
            parts: [{ text }],
          })
          scrollToBottom()
        },
        onStatement: (statement) => {
          if (talkMode === 'voice') {
            // Remove list symbols and adjust layout
            const audioText = statement.replaceAll('*', '').replaceAll('\n\n', '\n')
            speech(audioText)
          }
        },
        onFinish: async () => {
          scrollToBottom()
          saveMessage()
          if (maxHistoryLength > 0) {
            const textMessages: Message[] = []
            for (const item of messagesRef.current) {
              for (const part of item.parts) {
                if (part.text) textMessages.push(item)
              }
            }
            const messageList = textMessages.filter((item) => !summary.ids.includes(item.id))
            if (messageList.length > maxHistoryLength) {
              await summarize(textMessages)
            }
          }
        },
      })
    },
    [scrollToBottom, speech, summarize],
  )

  const handleSubmit = useCallback(
    async (text: string): Promise<void> => {
      if (content === '') return Promise.reject(false)
      const { talkMode, model } = useSettingStore.getState()
      const { files, clear: clearAttachment } = useAttachmentStore.getState()
      const { summary, add: addMessage } = useMessageStore.getState()
      const messagePart: Message['parts'] = []
      if (files.length > 0) {
        for (const file of files) {
          if (isVisionModel) {
            if (file.preview) {
              messagePart.push({
                inlineData: {
                  mimeType: file.mimeType,
                  data: file.preview.split(';base64,')[1],
                },
              })
            }
          } else {
            if (file.metadata) {
              messagePart.push({
                fileData: {
                  mimeType: file.metadata.mimeType,
                  fileUri: file.metadata.uri,
                },
              })
            }
          }
        }
      }
      messagePart.push({ text })
      const newUserMessage: Message = {
        id: nanoid(),
        role: 'user',
        parts: messagePart,
        attachments: isVisionModel ? [] : files,
      }
      addMessage(newUserMessage)
      const newModelMessage: Message = { id: nanoid(), role: 'model', parts: [{ text: '' }] }
      addMessage(newModelMessage)
      let messages: Message[] = [...messagesRef.current.slice(0, -1)]
      if (summary.content !== '') {
        const newMessages = messages.filter((item) => !summary.ids.includes(item.id))
        messages = [...getSummaryPrompt(summary.content), ...newMessages]
      }
      if (talkMode === 'voice') {
        messages = getVoiceModelPrompt(messages)
        setStatus('thinkng')
        setSubtitle('')
      }
      setContent('')
      clearAttachment()
      setTextareaHeight(24)
      await fetchAnswer({
        messages,
        model,
        onResponse: (stream) => {
          handleResponse(stream, newModelMessage)
        },
        onError: (message, code) => {
          handleError(message, code)
        },
      })
    },
    [content, isVisionModel, fetchAnswer, handleResponse, handleError],
  )

  const handleResubmit = useCallback(async () => {
    const messages = [...messagesRef.current]
    const lastMessage = messages.pop()
    const { model } = useSettingStore.getState()
    const { add: addMessage, update: updateMessage } = useMessageStore.getState()
    if (lastMessage?.role === 'model') {
      lastMessage.parts = [{ text: '' }]
      updateMessage(lastMessage.id, lastMessage)
      await fetchAnswer({
        messages: messagesRef.current,
        model,
        onResponse: (stream) => {
          handleResponse(stream, lastMessage)
        },
        onError: (message, code) => {
          handleError(message, code)
        },
      })
    } else {
      const newModelMessage: Message = { id: nanoid(), role: 'model', parts: [{ text: '' }] }
      addMessage(newModelMessage)
      await fetchAnswer({
        messages: messagesRef.current.slice(0, -1),
        model,
        onResponse: (stream) => {
          handleResponse(stream, newModelMessage)
        },
        onError: (message, code) => {
          handleError(message, code)
        },
      })
    }
  }, [fetchAnswer, handleResponse, handleError])

  const handleCleanMessage = useCallback(() => {
    const { clear: clearMessage } = useMessageStore.getState()
    clearMessage()
    setErrorMessage('')
  }, [])

  const updateTalkMode = useCallback((type: 'chat' | 'voice') => {
    const { setTalkMode } = useSettingStore.getState()
    setTalkMode(type)
  }, [])

  const checkAccessStatus = useCallback(() => {
    const { isProtected, password, apiKey } = useSettingStore.getState()
    const isProtectedMode = isProtected && password === '' && apiKey === ''
    const isStaticMode = buildMode === 'export' && apiKey === ''
    if (isProtectedMode || isStaticMode) {
      setSetingOpen(true)
      return false
    } else {
      return true
    }
  }, [])

  const startRecordTime = useCallback(() => {
    const intervalTimer = setInterval(() => {
      setRecordTime((time) => time + 1)
    }, 1000)
    setRecordTimer(intervalTimer)
  }, [])

  const endRecordTimer = useCallback(() => {
    clearInterval(recordTimer)
  }, [recordTimer])

  const handleRecorder = useCallback(() => {
    if (!checkAccessStatus()) return false
    if (!audioStreamRef.current) {
      audioStreamRef.current = new AudioStream()
    }
    if (speechRecognitionRef.current) {
      const { talkMode } = useSettingStore.getState()
      if (isRecording) {
        speechRecognitionRef.current.stop()
        endRecordTimer()
        setRecordTime(0)
        if (talkMode === 'voice') {
          handleSubmit(speechRecognitionRef.current.text)
        }
        setIsRecording(false)
      } else {
        speechRecognitionRef.current.start()
        setIsRecording(true)
        startRecordTime()
      }
    }
  }, [checkAccessStatus, handleSubmit, startRecordTime, endRecordTimer, isRecording])

  const handleStopTalking = useCallback(() => {
    setSpeechSilence(true)
    speechQueue.current?.empty()
    audioStreamRef.current?.stop()
    setStatus('silence')
  }, [])

  const handleKeyDown = useCallback(
    (ev: KeyboardEvent<HTMLTextAreaElement>) => {
      if (ev.key === 'Enter' && !ev.shiftKey && !isRecording) {
        if (!checkAccessStatus()) return false
        // Prevent the default carriage return and line feed behavior
        ev.preventDefault()
        handleSubmit(content)
      }
    },
    [content, isRecording, handleSubmit, checkAccessStatus],
  )

  const initAssistant = useCallback((prompt: string) => {
    const { instruction, clear: clearMessage } = useMessageStore.getState()
    clearMessage()
    instruction(prompt)
  }, [])

  useEffect(() => useMessageStore.subscribe((state) => (messagesRef.current = state.messages)), [])

  useEffect(() => {
    requestAnimationFrame(scrollToBottom)
  }, [messagesRef.current.length, scrollToBottom])

  useEffect(() => {
    try {
      speechRecognitionRef.current = new SpeechRecognition({
        locale: settingStore.sttLang,
        onUpdate: (text) => {
          setContent(text)
        },
      })
    } catch (err) {
      console.error(err)
      setDisableSpeechRecognition(true)
    }
  }, [settingStore.sttLang])

  useEffect(() => {
    const setting = useSettingStore.getState()
    if (setting.ttsLang !== '') {
      const edgeSpeech = new EdgeSpeech({ locale: setting.ttsLang })
      edgeSpeechRef.current = edgeSpeech
      if (setting.ttsVoice === '') {
        const voiceOptions = edgeSpeech.voiceOptions
        setting.setTTSVoice(voiceOptions ? (voiceOptions[0].value as string) : 'en-US-JennyNeural')
      }
    }
  }, [settingStore.ttsLang])

  useLayoutEffect(() => {
    const instance = new SiriWave({
      container: siriWaveRef.current!,
      style: 'ios9',
      speed: 0.04,
      amplitude: 0.1,
      width: window.innerWidth,
      height: window.innerHeight / 5,
    })
    setSiriWave(instance)
    return () => {
      instance.dispose()
    }
  }, [])

  return (
    <main className="mx-auto flex min-h-full max-w-screen-md flex-col justify-between pb-20 pt-6 max-sm:pb-16 max-sm:pt-0 landscape:max-md:pt-0">
      <div className="mb-2 mt-6 flex justify-between p-4 pr-2 max-sm:mt-2 max-sm:pr-2 landscape:max-md:mt-0">
        <div className="flex flex-row text-xl leading-8 text-black-400 max-sm:text-base">
          <Bot className="h-10 w-10 max-sm:h-8 max-sm:w-8" />
          <div className="ml-3 font-bold leading-10 max-sm:leading-8">{t('title')}</div>
        </div>
        <div className="flex items-center gap-1">
          <Button title={t('github')} variant="ghost" size="icon" className="h-8 w-8">
            <Github className="h-5 w-5" onClick={() => window.open('https://github.com/The-UnknownHacker/GhostAI-v3')} />
          </Button>
          <ThemeToggle />
          <Button
            className="h-8 w-8"
            title={t('setting')}
            variant="ghost"
            size="icon"
            onClick={() => setSetingOpen(true)}
          >
            <Settings className="h-5 w-5" />
          </Button>
        </div>
      </div>
      {messageStore.messages.length === 0 && content === '' && messageStore.systemInstruction === '' ? (
        <AssistantRecommend initAssistant={initAssistant} />
      ) : (
        <div className="flex min-h-full flex-1 grow flex-col justify-start">
          {messageStore.systemInstruction !== '' ? (
            <div className="p-4 pt-0">
              <SystemInstruction prompt={messageStore.systemInstruction} onClear={() => initAssistant('')} />
            </div>
          ) : null}
          {messageStore.messages.map((msg, idx) => (
            <div
              className="group text-slate-500 transition-colors last:text-slate-800 hover:text-slate-800 dark:last:text-slate-400 dark:hover:text-slate-400 max-sm:hover:bg-transparent"
              key={msg.id}
            >
              <div className="flex gap-3 p-4 hover:bg-gray-50/80 dark:hover:bg-gray-900/80">
                <MessageItem {...msg} />
              </div>
            </div>
          ))}
          {errorMessage !== '' ? (
            <div className="group text-slate-500 transition-colors last:text-slate-800 hover:text-slate-800 dark:last:text-slate-400 dark:hover:text-slate-400 max-sm:hover:bg-transparent">
              <div className="flex gap-3 p-4 hover:bg-gray-50/80 dark:hover:bg-gray-900/80">
                <ErrorMessageItem content={errorMessage} />
              </div>
            </div>
          ) : null}
          {content !== '' ? (
            <div className="group text-slate-500 transition-colors last:text-slate-800 hover:text-slate-800 dark:last:text-slate-400 dark:hover:text-slate-400 max-sm:hover:bg-transparent">
              <div className="flex gap-3 p-4 hover:bg-gray-50/80 dark:hover:bg-gray-900/80">
                <MessageItem id="tmp" role="user" parts={[{ text: content }]} />
              </div>
            </div>
          ) : null}
          {messageStore.messages.length > 0 ? (
            <div className="my-2 flex h-4 justify-center text-xs text-slate-400 duration-300 dark:text-slate-600">
              <span className="mx-2 cursor-pointer hover:text-slate-500" onClick={() => handleResubmit()}>
                {t('regenerateAnswer')}
              </span>
              <Separator orientation="vertical" />
              <span className="mx-2 cursor-pointer hover:text-slate-500" onClick={() => handleCleanMessage()}>
                {t('clearChatContent')}
              </span>
            </div>
          ) : null}
        </div>
      )}
      <div ref={scrollAreaBottomRef}></div>
      <div className="fixed bottom-0 flex w-full max-w-screen-md items-end gap-2 p-4 pb-8 max-sm:p-2 max-sm:pb-3 landscape:max-md:pb-4">
        {!disableSpeechRecognition ? (
          <Button title={t('voiceMode')} variant="secondary" size="icon" onClick={() => updateTalkMode('voice')}>
            <AudioLines />
          </Button>
        ) : null}
        <div className="relative w-full rounded-md border border-input bg-[hsl(var(--background))] pt-2">
          <AttachmentArea className="m-2 mt-0 max-h-32 overflow-y-auto border-b border-dashed pb-2" />
          <textarea
            className={cn(
              'h-auto max-h-[120px] w-full resize-none border-none bg-transparent px-2 text-sm leading-6 transition-[height] focus-visible:outline-none',
              disableSpeechRecognition ? 'pr-9' : 'pr-[72px]',
            )}
            style={{ height: textareaHeight > 24 ? `${textareaHeight}px` : 'auto' }}
            value={content}
            placeholder={t('askAQuestion')}
            rows={1}
            onChange={(ev) => {
              setContent(ev.target.value)
              setTextareaHeight(ev.target.value === '' ? 24 : ev.target.scrollHeight)
            }}
            onKeyDown={handleKeyDown}
          />
          <div className="absolute bottom-0.5 right-1 flex">
            {supportAttachment ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="box-border flex h-8 w-8 cursor-pointer items-center justify-center rounded-full p-1.5 text-slate-800 hover:bg-secondary/80 dark:text-slate-600">
                      <FileUploader />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent className="mb-1 max-w-36">
                    {isVisionModel ? t('imageUploadTooltip') : t('uploadTooltip')}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : null}
            {!disableSpeechRecognition ? (
              <TooltipProvider>
                <Tooltip open={isRecording}>
                  <TooltipTrigger asChild>
                    <div
                      className="box-border flex h-8 w-8 cursor-pointer items-center justify-center rounded-full p-1.5 text-slate-800 hover:bg-secondary/80 dark:text-slate-600"
                      onClick={() => handleRecorder()}
                    >
                      <Mic className={isRecording ? 'animate-pulse' : ''} />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent className="mb-1 px-2 py-1 text-center font-mono text-black-500">
                    {formatTime(recordTime)}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : null}
          </div>
        </div>
        <Button
          title={t('send')}
          variant="secondary"
          size="icon"
          disabled={isRecording || isUploading}
          onClick={() => handleSubmit(content)}
        >
          <SendHorizontal />
        </Button>
      </div>
      <div style={{ display: settingStore.talkMode === 'voice' ? 'block' : 'none' }}>
        <div className="fixed left-0 right-0 top-0 flex h-full w-screen flex-col items-center justify-center bg-slate-900">
          <div className="h-1/5 w-full" ref={siriWaveRef}></div>
          <div className="absolute bottom-0 flex h-2/5 w-2/3 flex-col justify-between pb-12 text-center">
            <div className="text-sm leading-6">
              <div className="animate-pulse text-lg text-white">{statusText}</div>
              {errorMessage !== '' ? (
                <div className="whitespace-pre-wrap text-center font-semibold text-red-500">{errorMessage}</div>
              ) : status === 'talking' ? (
                <div className="whitespace-pre-wrap text-center text-red-300">{subtitle}</div>
              ) : (
                <div className="whitespace-pre-wrap text-center text-green-300">{content}</div>
              )}
            </div>
            <div className="flex items-center justify-center pt-2">
              <Button
                className="h-10 w-10 rounded-full text-slate-700 dark:text-slate-500"
                title={t('chatMode')}
                variant="secondary"
                size="icon"
                onClick={() => updateTalkMode('chat')}
              >
                <MessageSquareText />
              </Button>
              {status === 'talking' ? (
                <Button
                  className="mx-6 h-14 w-14 rounded-full"
                  title={t('stopTalking')}
                  variant="destructive"
                  size="icon"
                  onClick={() => handleStopTalking()}
                >
                  <Pause />
                </Button>
              ) : (
                <Button
                  className="mx-6 h-14 w-14 rounded-full font-mono"
                  title={t('startRecording')}
                  variant="destructive"
                  size="icon"
                  disabled={status === 'thinkng'}
                  onClick={() => handleRecorder()}
                >
                  {isRecording ? formatTime(recordTime) : <Mic className="h-8 w-8" />}
                </Button>
              )}
              <Button
                className="h-10 w-10 rounded-full text-slate-700 dark:text-slate-500"
                title={t('setting')}
                variant="secondary"
                size="icon"
                onClick={() => setSetingOpen(true)}
              >
                <Settings />
              </Button>
            </div>
          </div>
        </div>
      </div>
      <Setting open={settingOpen} hiddenTalkPanel={disableSpeechRecognition} onClose={() => setSetingOpen(false)} />
    </main>
  )
}
