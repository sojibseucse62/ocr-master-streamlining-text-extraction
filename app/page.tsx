"use client"

import React from "react"

import { useState, useRef, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Upload, ZoomIn, ZoomOut, Copy, RotateCcw, Loader2, FileText, Eye } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import Tesseract from "tesseract.js"

interface Selection {
  x: number
  y: number
  width: number
  height: number
}

interface PDFPage {
  canvas: HTMLCanvasElement
  pageNumber: number
}

const customStyles = `
  @keyframes fade-in {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }
  
  @keyframes fade-in-delay {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }
  
  @keyframes pulse-glow {
    0%, 100% { box-shadow: 0 0 20px rgba(59, 130, 246, 0.3); }
    50% { box-shadow: 0 0 30px rgba(59, 130, 246, 0.6); }
  }
  
  .animate-fade-in {
    animation: fade-in 0.8s ease-out;
  }
  
  .animate-fade-in-delay {
    animation: fade-in-delay 0.8s ease-out 0.3s both;
  }
  
  .animate-pulse-glow {
    animation: pulse-glow 2s ease-in-out infinite;
  }
  
  .gradient-border {
    background: linear-gradient(45deg, #3b82f6, #8b5cf6, #6366f1);
    padding: 2px;
    border-radius: 12px;
  }
  
  .gradient-border-inner {
    background: white;
    border-radius: 10px;
  }
`

export default function OCRTool() {
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [pdfPages, setPdfPages] = useState<PDFPage[]>([])
  const [currentPage, setCurrentPage] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [isProcessing, setIsProcessing] = useState(false)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [isSelecting, setIsSelecting] = useState(false)
  const [extractedText, setExtractedText] = useState("")
  const [ocrLanguage, setOcrLanguage] = useState("eng+ben") // English + Bengali

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { toast } = useToast()

  const handleFileUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return

      const isImage = file.type.startsWith("image/")
      const isPDF = file.type === "application/pdf"

      if (!isImage && !isPDF) {
        toast({
          title: "Invalid file",
          description: "Please upload a PDF, JPG, or PNG file.",
          variant: "destructive",
        })
        return
      }

      setPdfFile(file)
      setIsProcessing(true)

      try {
        if (isImage) {
          // Handle image files
          const img = new Image()
          img.crossOrigin = "anonymous"

          await new Promise((resolve, reject) => {
            img.onload = resolve
            img.onerror = reject
            img.src = URL.createObjectURL(file)
          })

          const canvas = document.createElement("canvas")
          const context = canvas.getContext("2d")!
          canvas.width = img.width
          canvas.height = img.height
          context.drawImage(img, 0, 0)

          setPdfPages([{ canvas, pageNumber: 1 }])
          setCurrentPage(0)

          // Clean up object URL
          URL.revokeObjectURL(img.src)

          toast({
            title: "Image loaded successfully",
            description: "Ready for text extraction",
          })
        } else {
          // Handle PDF files (existing logic)
          const pdfjsModule = await import("pdfjs-dist")
          const pdfjs = (pdfjsModule as any).default ?? pdfjsModule
          pdfjs.GlobalWorkerOptions.workerSrc = "//cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"

          const arrayBuffer = await file.arrayBuffer()
          const pdf = await pdfjs.getDocument(arrayBuffer).promise
          const pages: PDFPage[] = []

          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i)
            const viewport = page.getViewport({ scale: 2 })

            const canvas = document.createElement("canvas")
            const context = canvas.getContext("2d")!
            canvas.height = viewport.height
            canvas.width = viewport.width

            await page.render({
              canvasContext: context,
              viewport: viewport,
            }).promise

            pages.push({ canvas, pageNumber: i })
          }

          setPdfPages(pages)
          setCurrentPage(0)
          toast({
            title: "PDF loaded successfully",
            description: `${pages.length} pages processed`,
          })
        }
      } catch (error) {
        console.error("Error processing file:", error)
        toast({
          title: "Error",
          description: "Failed to process file.",
          variant: "destructive",
        })
      } finally {
        setIsProcessing(false)
      }
    },
    [toast],
  )

  const drawCurrentPage = useCallback(() => {
    if (!canvasRef.current || !pdfPages[currentPage]) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext("2d")!
    const sourcePage = pdfPages[currentPage]

    canvas.width = sourcePage.canvas.width * zoom
    canvas.height = sourcePage.canvas.height * zoom

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.scale(zoom, zoom)
    ctx.drawImage(sourcePage.canvas, 0, 0)
    ctx.setTransform(1, 0, 0, 1, 0, 0)

    // Draw selection if exists
    if (selection) {
      ctx.strokeStyle = "#3b82f6"
      ctx.lineWidth = 2
      ctx.setLineDash([5, 5])
      // Don't multiply by zoom - selection coordinates are already in canvas pixels
      ctx.strokeRect(selection.x, selection.y, selection.width, selection.height)

      // Fill with semi-transparent blue
      ctx.fillStyle = "rgba(59, 130, 246, 0.1)"
      ctx.fillRect(selection.x, selection.y, selection.width, selection.height)
    }
  }, [currentPage, pdfPages, zoom, selection])

  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isSelecting || !canvasRef.current) return

      const canvas = canvasRef.current
      const rect = canvas.getBoundingClientRect()

      // Get the actual canvas size vs display size ratio
      const scaleX = canvas.width / rect.width
      const scaleY = canvas.height / rect.height

      // Calculate coordinates in actual canvas pixels
      const x = (event.clientX - rect.left) * scaleX
      const y = (event.clientY - rect.top) * scaleY

      setSelection({ x, y, width: 0, height: 0 })

      const handleMouseMove = (e: MouseEvent) => {
        // Get fresh bounding rect for each mouse move event
        const currentRect = canvas.getBoundingClientRect()
        const currentScaleX = canvas.width / currentRect.width
        const currentScaleY = canvas.height / currentRect.height

        const currentX = (e.clientX - currentRect.left) * currentScaleX
        const currentY = (e.clientY - currentRect.top) * currentScaleY

        setSelection({
          x: Math.min(x, currentX),
          y: Math.min(y, currentY),
          width: Math.abs(currentX - x),
          height: Math.abs(currentY - y),
        })
      }

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove)
        document.removeEventListener("mouseup", handleMouseUp)
        setIsSelecting(false)
      }

      document.addEventListener("mousemove", handleMouseMove)
      document.addEventListener("mouseup", handleMouseUp)
    },
    [isSelecting],
  )

  const performOCR = useCallback(async () => {
    if (!selection || !pdfPages[currentPage]) return

    setIsProcessing(true)
    try {
      const sourcePage = pdfPages[currentPage]
      const tempCanvas = document.createElement("canvas")
      const tempCtx = tempCanvas.getContext("2d")!

      // Extract selected region - selection coordinates are already in canvas pixels
      const sourceX = selection.x / zoom
      const sourceY = selection.y / zoom
      const sourceWidth = selection.width / zoom
      const sourceHeight = selection.height / zoom

      tempCanvas.width = sourceWidth
      tempCanvas.height = sourceHeight

      tempCtx.drawImage(sourcePage.canvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight)

      const {
        data: { text },
      } = await Tesseract.recognize(tempCanvas, ocrLanguage, {
        logger: (m) => console.log(m),
      })

      setExtractedText(text.trim())
      toast({
        title: "OCR completed",
        description: "Text extracted successfully",
      })
    } catch (error) {
      console.error("OCR Error:", error)
      toast({
        title: "OCR failed",
        description: "Failed to extract text from selection.",
        variant: "destructive",
      })
    } finally {
      setIsProcessing(false)
    }
  }, [selection, pdfPages, currentPage, ocrLanguage, toast, zoom])

  const copyToClipboard = useCallback(async () => {
    if (!extractedText) return

    try {
      await navigator.clipboard.writeText(extractedText)
      toast({
        title: "Copied!",
        description: "Text copied to clipboard",
      })
    } catch (error) {
      toast({
        title: "Copy failed",
        description: "Failed to copy text to clipboard.",
        variant: "destructive",
      })
    }
  }, [extractedText, toast])

  // Update canvas when dependencies change
  React.useEffect(() => {
    drawCurrentPage()
  }, [drawCurrentPage])

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: customStyles }} />
      <div className="container mx-auto p-6 max-w-7xl">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-600 bg-clip-text text-transparent animate-fade-in">
            OCR Master: Streamlining Text Extraction
          </h1>
          <p className="text-muted-foreground text-lg animate-fade-in-delay">
            Upload a PDF, JPG or PNG, zoom and select text regions to extract text using OCR
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Upload and Controls */}
          <div className="lg:col-span-1 space-y-4">
            <div className="gradient-border animate-fade-in">
              <Card className="gradient-border-inner">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                    <Upload className="w-5 h-5 text-blue-600" />
                    Upload PDF or Image
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="pdf-upload" className="text-sm font-medium">
                        Select PDF or Image File
                      </Label>
                      <Input
                        id="pdf-upload"
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png"
                        onChange={handleFileUpload}
                        disabled={isProcessing}
                        className="mt-2 transition-all duration-300 hover:border-blue-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                      />
                    </div>

                    {pdfFile && (
                      <div className="text-sm text-muted-foreground bg-gradient-to-r from-blue-50 to-purple-50 p-3 rounded-lg border animate-fade-in">
                        <FileText className="w-4 h-4 inline mr-2 text-blue-600" />
                        <span className="font-medium">{pdfFile.name}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {pdfPages.length > 0 && (
              <>
                <Card className="transition-all duration-300 hover:shadow-lg hover:scale-[1.02]">
                  <CardHeader>
                    <CardTitle className="bg-gradient-to-r from-green-600 to-blue-600 bg-clip-text text-transparent">
                      Navigation
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label>
                        Page {currentPage + 1} of {pdfPages.length}
                      </Label>
                      <div className="flex gap-2 mt-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
                          disabled={currentPage === 0}
                          className="transition-all duration-300 hover:scale-105 hover:shadow-md"
                        >
                          Previous
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage(Math.min(pdfPages.length - 1, currentPage + 1))}
                          disabled={currentPage === pdfPages.length - 1}
                          className="transition-all duration-300 hover:scale-105 hover:shadow-md"
                        >
                          Next
                        </Button>
                      </div>
                    </div>

                    <div>
                      <Label>Zoom: {Math.round(zoom * 100)}%</Label>
                      <div className="flex gap-2 mt-2">
                        <Button variant="outline" size="sm" onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}>
                          <ZoomOut className="w-4 h-4" />
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setZoom(Math.min(3, zoom + 0.25))}>
                          <ZoomIn className="w-4 h-4" />
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setZoom(1)}>
                          <RotateCcw className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>

                    <div>
                      <Label>OCR Language</Label>
                      <select
                        className="w-full mt-1 p-2 border rounded"
                        value={ocrLanguage}
                        onChange={(e) => setOcrLanguage(e.target.value)}
                      >
                        <option value="eng">English</option>
                        <option value="ben">Bengali</option>
                        <option value="eng+ben">English + Bengali</option>
                      </select>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Text Selection</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Button
                      onClick={() => setIsSelecting(!isSelecting)}
                      variant={isSelecting ? "default" : "outline"}
                      className={`w-full transition-all duration-300 hover:scale-105 ${
                        isSelecting
                          ? "animate-pulse-glow bg-gradient-to-r from-blue-600 to-purple-600"
                          : "hover:shadow-lg"
                      }`}
                    >
                      <Eye className="w-4 h-4 mr-2" />
                      {isSelecting ? "Cancel Selection" : "Select Text"}
                    </Button>

                    {selection && (
                      <div className="space-y-2">
                        <Badge variant="secondary">
                          Selection: {Math.round(selection.width)} × {Math.round(selection.height)}px
                        </Badge>
                        <Button onClick={performOCR} disabled={isProcessing} className="w-full">
                          {isProcessing ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <FileText className="w-4 h-4 mr-2" />
                          )}
                          Extract Text
                        </Button>
                      </div>
                    )}

                    <Button
                      onClick={() => setSelection(null)}
                      variant="outline"
                      className="w-full"
                      disabled={!selection}
                    >
                      Clear Selection
                    </Button>
                  </CardContent>
                </Card>
              </>
            )}
          </div>

          {/* PDF Viewer */}
          <div className="lg:col-span-2">
            <Card className="h-fit transition-all duration-300 hover:shadow-xl">
              <CardHeader>
                <CardTitle className="bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
                  File Viewer
                </CardTitle>
              </CardHeader>
              <CardContent>
                {pdfPages.length > 0 ? (
                  <div
                    ref={containerRef}
                    className="border rounded-lg overflow-auto max-h-[600px] bg-gray-50"
                    style={{ cursor: isSelecting ? "crosshair" : "default" }}
                  >
                    <canvas ref={canvasRef} onMouseDown={handleMouseDown} className="max-w-full h-auto" />
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-64 border-2 border-dashed border-gray-300 rounded-lg">
                    <div className="text-center">
                      <Upload className="w-12 h-12 mx-auto text-gray-400 mb-4" />
                      <p className="text-gray-500">Upload a PDF or image to get started</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Extracted Text */}
            {extractedText && (
              <Card className="mt-4 transition-all duration-300 hover:shadow-lg animate-fade-in">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">
                    Extracted Text
                    <Button
                      onClick={copyToClipboard}
                      size="sm"
                      variant="outline"
                      className="transition-all duration-300 hover:scale-105 hover:bg-gradient-to-r hover:from-emerald-50 hover:to-teal-50 bg-transparent"
                    >
                      <Copy className="w-4 h-4 mr-2" />
                      Copy
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Textarea
                    value={extractedText}
                    onChange={(e) => setExtractedText(e.target.value)}
                    className="min-h-[150px]"
                    placeholder="Extracted text will appear here..."
                  />
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {isProcessing && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fade-in">
            <Card className="p-6 animate-pulse-glow">
              <div className="flex items-center gap-4">
                <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                <div>
                  <p className="font-medium bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                    Processing...
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {pdfPages.length === 0 ? "Loading PDF..." : "Extracting text..."}
                  </p>
                </div>
              </div>
            </Card>
          </div>
        )}
      </div>
    </>
  )
}
