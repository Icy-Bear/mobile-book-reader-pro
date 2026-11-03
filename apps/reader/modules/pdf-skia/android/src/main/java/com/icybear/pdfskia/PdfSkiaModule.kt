package com.icybear.pdfskia

import android.graphics.Bitmap
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

    Function("close") { closeDocument() }
  }
}
