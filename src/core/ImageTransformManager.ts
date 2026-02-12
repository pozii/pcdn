import sharp, { ResizeOptions, OutputInfo } from 'sharp';
import { ImageTransformConfig, ImageTransformOptions, TransformedImageResult } from '../types';
import { Logger } from '../utils/Logger';
import * as path from 'path';

export class ImageTransformManager {
  private config: ImageTransformConfig;
  private logger: Logger;

  constructor(config: ImageTransformConfig) {
    this.config = {
      maxWidth: 4000,
      maxHeight: 4000,
      quality: 85,
      allowedFormats: ['jpeg', 'png', 'webp', 'avif', 'gif'],
      defaultFormat: 'jpeg',
      cacheTransformed: true,
      ...config
    };
    this.logger = new Logger('ImageTransformManager');

    if (this.config.enabled) {
      this.logger.info('Image transformation enabled', {
        maxWidth: this.config.maxWidth,
        maxHeight: this.config.maxHeight,
        quality: this.config.quality
      });
    }
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  isImageFile(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase().replace('.', '');
    const imageExtensions = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'bmp', 'tiff', 'svg'];
    return imageExtensions.includes(ext);
  }

  parseTransformOptions(query: Record<string, any>): ImageTransformOptions | null {
    if (!this.config.enabled) return null;

    const options: ImageTransformOptions = {};
    let hasTransform = false;

    // Parse width
    if (query.w || query.width) {
      const width = parseInt(query.w || query.width, 10);
      if (!isNaN(width) && width > 0) {
        options.width = Math.min(width, this.config.maxWidth || 4000);
        hasTransform = true;
      }
    }

    // Parse height
    if (query.h || query.height) {
      const height = parseInt(query.h || query.height, 10);
      if (!isNaN(height) && height > 0) {
        options.height = Math.min(height, this.config.maxHeight || 4000);
        hasTransform = true;
      }
    }

    // Parse quality
    if (query.q || query.quality) {
      const quality = parseInt(query.q || query.quality, 10);
      if (!isNaN(quality) && quality >= 1 && quality <= 100) {
        options.quality = quality;
        hasTransform = true;
      }
    }

    // Parse format
    if (query.f || query.format) {
      const format = (query.f || query.format).toLowerCase();
      if (this.config.allowedFormats?.includes(format)) {
        options.format = format as any;
        hasTransform = true;
      }
    }

    // Parse fit mode
    if (query.fit) {
      const validFits = ['cover', 'contain', 'fill', 'inside', 'outside'];
      if (validFits.includes(query.fit)) {
        options.fit = query.fit as any;
        hasTransform = true;
      }
    }

    // Parse position
    if (query.pos || query.position) {
      const pos = query.pos || query.position;
      const validPositions = ['top', 'right', 'bottom', 'left', 'center', 'centre'];
      if (validPositions.includes(pos)) {
        options.position = pos as any;
        hasTransform = true;
      }
    }

    return hasTransform ? options : null;
  }

  async transform(buffer: Buffer, options: ImageTransformOptions): Promise<TransformedImageResult> {
    if (!this.config.enabled) {
      throw new Error('Image transformation is not enabled');
    }

    try {
      let sharpInstance = sharp(buffer);
      
      // Get metadata
      const metadata = await sharpInstance.metadata();
      
      // Build resize options
      const resizeOptions: ResizeOptions = {};
      
      if (options.width) resizeOptions.width = options.width;
      if (options.height) resizeOptions.height = options.height;
      if (options.fit) resizeOptions.fit = options.fit;
      if (options.position) resizeOptions.position = options.position;
      
      // WithoutEnlargement - don't upscale small images
      resizeOptions.withoutEnlargement = true;

      // Apply resize if dimensions specified
      if (options.width || options.height) {
        sharpInstance = sharpInstance.resize(resizeOptions);
      }

      // Determine output format
      const outputFormat = options.format || this.getFormatFromContentType(metadata.format) || this.config.defaultFormat || 'jpeg';
      const quality = options.quality || this.config.quality || 85;

      // Apply format and compression
      switch (outputFormat) {
        case 'jpeg':
        case 'jpg':
          sharpInstance = sharpInstance.jpeg({ 
            quality,
            progressive: true,
            mozjpeg: true 
          });
          break;
        case 'png':
          sharpInstance = sharpInstance.png({ 
            quality: Math.min(quality, 100),
            progressive: true 
          });
          break;
        case 'webp':
          sharpInstance = sharpInstance.webp({ 
            quality,
            effort: 4 
          });
          break;
        case 'avif':
          sharpInstance = sharpInstance.avif({ 
            quality,
            effort: 4 
          });
          break;
        case 'gif':
          // GIFs are passed through without transformation
          // as sharp has limited GIF support
          break;
      }

      // Process image
      const processedBuffer = await sharpInstance.toBuffer({ resolveWithObject: true });
      
      return {
        buffer: processedBuffer.data,
        contentType: `image/${outputFormat === 'jpg' ? 'jpeg' : outputFormat}`,
        width: processedBuffer.info.width,
        height: processedBuffer.info.height,
        size: processedBuffer.data.length
      };

    } catch (error) {
      this.logger.error('Image transformation failed', { error, options });
      throw error;
    }
  }

  generateTransformKey(originalKey: string, options: ImageTransformOptions): string {
    const params = [];
    if (options.width) params.push(`w${options.width}`);
    if (options.height) params.push(`h${options.height}`);
    if (options.quality) params.push(`q${options.quality}`);
    if (options.format) params.push(`f${options.format}`);
    if (options.fit) params.push(`fit${options.fit}`);
    if (options.position) params.push(`pos${options.position}`);
    
    if (params.length === 0) return originalKey;
    
    return `${originalKey}_${params.join('_')}`;
  }

  private getFormatFromContentType(format?: string): string | undefined {
    if (!format) return undefined;
    
    const formatMap: Record<string, string> = {
      'jpeg': 'jpeg',
      'jpg': 'jpeg',
      'png': 'png',
      'webp': 'webp',
      'gif': 'gif',
      'avif': 'avif',
      'svg': 'png' // Convert SVG to PNG
    };
    
    return formatMap[format.toLowerCase()];
  }

  getConfig(): ImageTransformConfig {
    return { ...this.config };
  }
}
