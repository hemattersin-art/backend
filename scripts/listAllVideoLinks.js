require('dotenv').config();
const supabaseAdmin = require('../config/supabase').supabaseAdmin;

// Normalize YouTube URLs to remove duplicates (www vs non-www)
function normalizeVideoUrl(url) {
  if (!url) return url;
  // Normalize YouTube URLs
  return url.replace(/^https?:\/\/(www\.)?youtube\.com/, 'https://www.youtube.com');
}

async function listAllVideoLinks() {
  try {
    const allVideos = [];
    const uniqueVideoUrls = new Set();

    // Fetch videos from counselling_services
    console.log('Fetching videos from counselling_services...');
    const { data: counsellingPages, error: counsellingError } = await supabaseAdmin
      .from('counselling_services')
      .select('id, slug, videos, status')
      .eq('status', 'published');

    if (counsellingError) {
      console.error('Error fetching counselling videos:', counsellingError);
    } else {
      counsellingPages?.forEach(page => {
        if (page.videos && Array.isArray(page.videos)) {
          page.videos.forEach(video => {
            const videoUrl = video.url || video.src;
            if (videoUrl) {
              const normalizedUrl = normalizeVideoUrl(videoUrl);
              if (!uniqueVideoUrls.has(normalizedUrl)) {
                uniqueVideoUrls.add(normalizedUrl);
                allVideos.push({
                  url: videoUrl, // Keep original URL for display
                  normalizedUrl: normalizedUrl,
                  title: video.title || 'No title',
                  thumbnailUrl: video.thumbnailUrl || video.poster || 'No thumbnail',
                  source: 'counselling',
                  pageSlug: page.slug,
                  pageId: page.id
                });
              }
            }
          });
        }
      });
      console.log(`Found ${counsellingPages?.length || 0} counselling pages`);
    }

    // Fetch videos from assessments
    console.log('Fetching videos from assessments...');
    const { data: assessmentPages, error: assessmentError } = await supabaseAdmin
      .from('assessments')
      .select('id, slug, videos, status')
      .eq('status', 'published');

    if (assessmentError) {
      console.error('Error fetching assessment videos:', assessmentError);
    } else {
      assessmentPages?.forEach(page => {
        if (page.videos && Array.isArray(page.videos)) {
          page.videos.forEach(video => {
            const videoUrl = video.url || video.src;
            if (videoUrl) {
              const normalizedUrl = normalizeVideoUrl(videoUrl);
              if (!uniqueVideoUrls.has(normalizedUrl)) {
                uniqueVideoUrls.add(normalizedUrl);
                allVideos.push({
                  url: videoUrl, // Keep original URL for display
                  normalizedUrl: normalizedUrl,
                  title: video.title || 'No title',
                  thumbnailUrl: video.thumbnailUrl || video.poster || 'No thumbnail',
                  source: 'assessments',
                  pageSlug: page.slug,
                  pageId: page.id
                });
              } else {
                // Video already exists, add to sources
                const existingVideo = allVideos.find(v => v.normalizedUrl === normalizedUrl);
                if (existingVideo && !existingVideo.sources) {
                  existingVideo.sources = [existingVideo.source];
                }
                if (existingVideo && !existingVideo.sources.includes('assessments')) {
                  existingVideo.sources.push('assessments');
                }
              }
            }
          });
        }
      });
      console.log(`Found ${assessmentPages?.length || 0} assessment pages`);
    }

    // Fetch videos from better_parenting
    console.log('Fetching videos from better_parenting...');
    const { data: betterParentingPages, error: betterParentingError } = await supabaseAdmin
      .from('better_parenting')
      .select('id, slug, videos, status')
      .eq('status', 'published');

    if (betterParentingError) {
      console.error('Error fetching better-parenting videos:', betterParentingError);
    } else {
      betterParentingPages?.forEach(page => {
        if (page.videos && Array.isArray(page.videos)) {
          page.videos.forEach(video => {
            const videoUrl = video.url || video.src;
            if (videoUrl) {
              const normalizedUrl = normalizeVideoUrl(videoUrl);
              if (!uniqueVideoUrls.has(normalizedUrl)) {
                uniqueVideoUrls.add(normalizedUrl);
                allVideos.push({
                  url: videoUrl, // Keep original URL for display
                  normalizedUrl: normalizedUrl,
                  title: video.title || 'No title',
                  thumbnailUrl: video.thumbnailUrl || video.poster || 'No thumbnail',
                  source: 'better-parenting',
                  pageSlug: page.slug,
                  pageId: page.id
                });
              } else {
                // Video already exists, add to sources
                const existingVideo = allVideos.find(v => v.normalizedUrl === normalizedUrl);
                if (existingVideo && !existingVideo.sources) {
                  existingVideo.sources = [existingVideo.source];
                }
                if (existingVideo && !existingVideo.sources.includes('better-parenting')) {
                  existingVideo.sources.push('better-parenting');
                }
              }
            }
          });
        }
      });
      console.log(`Found ${betterParentingPages?.length || 0} better-parenting pages`);
    }

    // Also include default videos from VideosShowcase component
    const defaultVideos = [
      { url: '/intro_2.mp4', title: 'Default Video 1', source: 'default', thumbnailUrl: '/testimonialgirl.png' },
      { url: '/intro_2.mp4', title: 'Default Video 2', source: 'default', thumbnailUrl: '/testimonial5.PNG' },
      { url: '/intro_2.mp4', title: 'Default Video 3', source: 'default', thumbnailUrl: '/TESTIMONIALS 4.webp' }
    ];

    console.log('\n=== UNIQUE VIDEO LINKS USED IN ADS PAGE ===\n');
    console.log(`Total unique videos: ${allVideos.length + 1}\n`); // +1 because /intro_2.mp4 appears 3 times but is same URL

    // Group by source
    const videosBySource = {};
    allVideos.forEach(video => {
      const source = video.source;
      if (!videosBySource[source]) {
        videosBySource[source] = [];
      }
      videosBySource[source].push(video);
    });

    // Print by source
    Object.keys(videosBySource).sort().forEach(source => {
      console.log(`\n--- ${source.toUpperCase()} (${videosBySource[source].length} videos) ---`);
      videosBySource[source].forEach((video, index) => {
        console.log(`\n${index + 1}. ${video.url}`);
        console.log(`   Title: ${video.title}`);
        console.log(`   Thumbnail: ${video.thumbnailUrl}`);
        console.log(`   Page: ${video.pageSlug} (ID: ${video.pageId})`);
      });
    });

    // Print default videos
    console.log(`\n--- DEFAULT VIDEOS (from VideosShowcase component) ---`);
    console.log(`\n1. /intro_2.mp4`);
    console.log(`   Used 3 times with different thumbnails:`);
    console.log(`   - /testimonialgirl.png`);
    console.log(`   - /testimonial5.PNG`);
    console.log(`   - /TESTIMONIALS 4.webp`);

    // Print just the URLs list
    console.log('\n\n=== SIMPLE URL LIST ===\n');
    allVideos.forEach((video, index) => {
      console.log(`${index + 1}. ${video.url}`);
    });
    console.log(`${allVideos.length + 1}. /intro_2.mp4 (default)`);

    console.log('\n\n=== SUMMARY ===');
    console.log(`Total unique video URLs: ${allVideos.length + 1}`);
    console.log(`- From database: ${allVideos.length}`);
    console.log(`- Default videos: 1 (used 3 times)`);
    console.log(`- From counselling: ${videosBySource['counselling']?.length || 0}`);
    console.log(`- From assessments: ${videosBySource['assessments']?.length || 0}`);
    console.log(`- From better-parenting: ${videosBySource['better-parenting']?.length || 0}`);

  } catch (error) {
    console.error('Error listing video links:', error);
  } finally {
    process.exit(0);
  }
}

listAllVideoLinks();
