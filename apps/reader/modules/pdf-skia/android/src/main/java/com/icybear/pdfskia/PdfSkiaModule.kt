package com.icybear.pdfskia

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.pm.ActivityInfo
import android.graphics.Bitmap
import android.graphics.RectF
import android.os.ParcelFileDescriptor
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import io.legere.pdfiumandroid.PdfDocument
import io.legere.pdfiumandroid.PdfiumCore
import java.io.ByteArrayOutputStream
import java.io.File

class PdfSkiaModule : Module() {
  private var core: PdfiumCore? = null
  private var document: PdfDocument? = null
  private var fileDescriptor: ParcelFileDescriptor? = null

  private fun pdfium(): PdfiumCore = core ?: PdfiumCore().also { core = it }

  private fun closeDocument() {
    document?.close()
    document = null
    runCatching { fileDescriptor?.close() }
    fileDescriptor = null
  }

  private fun meta(): Map<String, Any> {
    val doc = document ?: throw IllegalStateException("No PDF open")
    val core = pdfium()
    return mapOf(
      "pageCount" to core.getPageCount(doc),
      "width" to core.getPageWidthPoint(doc, 0),
      "height" to core.getPageHeightPoint(doc, 0),
    )
  }

  override fun definition() = ModuleDefinition {
    Name("PdfSkia")

    AsyncFunction("open") { path: String ->
      val file = File(path.removePrefix("file://"))
      if (!file.exists()) throw IllegalArgumentException("PDF not found: ${file.absolutePath}")
      closeDocument()
      val pfd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
      fileDescriptor = pfd
      document = pdfium().newDocument(pfd)
      meta()
    }

    AsyncFunction("openAsset") { assetName: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("No Android context")
      val bytes = context.assets.open(assetName).use { it.readBytes() }
      closeDocument()
      document = pdfium().newDocument(bytes)
      meta()
    }

    AsyncFunction("renderPage") { pageIndex: Int, targetWidth: Int ->
      val doc = document ?: throw IllegalStateException("No PDF open")
      if (targetWidth <= 0) throw IllegalArgumentException("targetWidth must be positive")
      val core = pdfium()
      val pageWidth = core.getPageWidthPoint(doc, pageIndex).coerceAtLeast(1)
      val pageHeight = core.getPageHeightPoint(doc, pageIndex).coerceAtLeast(1)
      val targetHeight = (targetWidth.toDouble() * pageHeight / pageWidth).toInt().coerceAtLeast(1)
      val bitmap = Bitmap.createBitmap(targetWidth, targetHeight, Bitmap.Config.ARGB_8888)
      core.renderPageBitmap(doc, bitmap, pageIndex, 0, 0, targetWidth, targetHeight, false, false)
      val out = ByteArrayOutputStream()
      bitmap.compress(Bitmap.CompressFormat.JPEG, 88, out)
      bitmap.recycle()
      val encoded = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
      "data:image/jpeg;base64,$encoded"
    }

    AsyncFunction("getPageText") { pageIndex: Int ->
      val doc = document ?: throw IllegalStateException("No PDF open")
      val page = doc.openPage(pageIndex) ?: throw IllegalStateException("Could not open page $pageIndex")
      val textPage = page.openTextPage()
      try {
        val count = textPage.textPageCountChars()
        if (count <= 0) ""
        else textPage.textPageGetText(0, count) ?: ""
      } finally {
        textPage.close()
        page.close()
      }
    }

    AsyncFunction("getTextAtPoint") { pageIndex: Int, xNorm: Double, yNorm: Double ->
      val doc = document ?: throw IllegalStateException("No PDF open")
      val core = pdfium()
      val pageW = core.getPageWidthPoint(doc, pageIndex).toFloat()
      val pageH = core.getPageHeightPoint(doc, pageIndex).toFloat()

      val page = doc.openPage(pageIndex) ?: throw IllegalStateException("Could not open page $pageIndex")
      val textPage = page.openTextPage()
      try {
        val xPt = (xNorm.toFloat() * pageW).coerceIn(0f, pageW)
        val yPt = ((1.0f - yNorm.toFloat()) * pageH).coerceIn(0f, pageH)

        val charIdx = textPage.textPageGetCharIndexAtPos(xPt.toDouble(), yPt.toDouble(), 18.0, 18.0)
        if (charIdx >= 0) {
          val charBox = textPage.textPageGetCharBox(charIdx)
          if (charBox != null) {
            val wordBox = RectF(
              (charBox.left - 40f).coerceAtLeast(0f),
              (charBox.top + 4f).coerceAtMost(pageH),
              (charBox.right + 40f).coerceAtMost(pageW),
              (charBox.bottom - 4f).coerceAtLeast(0f)
            )
            val raw = textPage.textPageGetBoundedText(wordBox, 128) ?: ""
            val word = raw.trim().split(Regex("\\s+")).firstOrNull { it.isNotEmpty() } ?: ""

            mapOf(
              "text" to word,
              "xNorm" to xNorm,
              "yNorm" to yNorm,
              "box" to mapOf(
                "x" to (charBox.left / pageW),
                "y" to (1f - charBox.top / pageH),
                "w" to ((charBox.right - charBox.left) / pageW),
                "h" to ((charBox.top - charBox.bottom) / pageH)
              )
            )
          } else {
            mapOf("text" to "", "xNorm" to xNorm, "yNorm" to yNorm)
          }
        } else {
          mapOf("text" to "", "xNorm" to xNorm, "yNorm" to yNorm)
        }
      } finally {
        textPage.close()
        page.close()
      }
    }

    Function("copyToClipboard") { text: String ->
      val context = appContext.reactContext ?: return@Function false
      val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
      val clip = ClipData.newPlainText("Den", text)
      clipboard?.setPrimaryClip(clip)
      true
    }

    Function("unlockOrientation") {
      appContext.currentActivity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
      true
    }

    Function("close") { closeDocument() }
  }
}
