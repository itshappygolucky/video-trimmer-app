let currentVideoPath = null;
let videoDuration = 0;
let startTime = 0;
let endTime = 0;
let losslessCutPoints = [];
let activeTrimHandle = null;
let folderVideos = [];
let playheadAnimationFrame = null;
let currentFolderPath = null;
let isScrubbingTimeline = false;
let isTrimHandlePreviewing = false;
let previewSeekRaf = null;
let pendingPreviewTime = null;
let scrubPreviewTime = null;
let lastVideoSeekAt = 0;
const SCRUB_SEEK_MIN_INTERVAL_MS = 80;
let currentVideo = null;
let currentAudioTracks = [];
let selectedAudioTrackIndexes = [];
let currentVideoStreamIndex = 0;
let audioTrackSelectionsByPath = {};
const settings = {
    appendCutTimes: true,
    rememberLastFolder: false,
    showDeleteOption: true,
    autoAdvance: false,
    darkMode: false,
    autoSaveEnabled: false,
    autoSaveFolder: '',
    promptDeleteSourceAfterTrim: false,
    showNotifications: false
};

const videoPlayer = document.getElementById('videoPlayer');
const selectVideoBtn = document.getElementById('selectVideoBtn');
const selectFolderBtn = document.getElementById('selectFolderBtn');
const playPauseBtn = document.getElementById('playPauseBtn');
const prevKeyframeBtn = document.getElementById('prevKeyframeBtn');
const nextKeyframeBtn = document.getElementById('nextKeyframeBtn');
const setStartBtn = document.getElementById('setStartBtn');
const setEndBtn = document.getElementById('setEndBtn');
const resetBtn = document.getElementById('resetBtn');
const screenshotBtn = document.getElementById('screenshotBtn');
const trimBtn = document.getElementById('trimBtn');
const startTimeInput = document.getElementById('startTime');
const endTimeInput = document.getElementById('endTime');
const fileInfo = document.getElementById('fileInfo');
const toastContainer = document.getElementById('toastContainer');
const audioTracksBtn = document.getElementById('audioTracksBtn');
const audioTracksModal = document.getElementById('audioTracksModal');
const audioTracksList = document.getElementById('audioTracksList');
const audioTracksSelectAllBtn = document.getElementById('audioTracksSelectAllBtn');
const audioTracksCancelBtn = document.getElementById('audioTracksCancelBtn');
const audioTracksApplyBtn = document.getElementById('audioTracksApplyBtn');
const TOAST_DURATION_MS = 5000;
let toastIdCounter = 0;
const folderSummary = document.getElementById('folderSummary');
const librarySearch = document.getElementById('librarySearch');
const libraryPanel = document.getElementById('libraryPanel');
const videoGrid = document.getElementById('videoGrid');
const videoSortSelect = document.getElementById('videoSort');
const trimSlider = document.getElementById('trimSlider');
const keyframeMarkers = document.getElementById('keyframeMarkers');
const selectedRange = document.getElementById('selectedRange');
const playheadMarker = document.getElementById('playheadMarker');
const timelineTooltip = document.getElementById('timelineTooltip');
const startHandle = document.getElementById('startHandle');
const endHandle = document.getElementById('endHandle');
const APPEND_CUT_TIMES_SETTING = 'videoTrimmer.appendCutTimes';
const REMEMBER_LAST_FOLDER_SETTING = 'videoTrimmer.rememberLastFolder';
const SHOW_DELETE_OPTION_SETTING = 'videoTrimmer.showDeleteOption';
const AUTO_ADVANCE_SETTING = 'videoTrimmer.autoAdvance';
const DARK_MODE_SETTING = 'videoTrimmer.darkMode';
const AUTO_SAVE_ENABLED_SETTING = 'videoTrimmer.autoSaveEnabled';
const AUTO_SAVE_FOLDER_SETTING = 'videoTrimmer.autoSaveFolder';
const PROMPT_DELETE_SOURCE_SETTING = 'videoTrimmer.promptDeleteSourceAfterTrim';
const SHOW_NOTIFICATIONS_SETTING = 'videoTrimmer.showNotifications';
const LAST_FOLDER_SETTING = 'videoTrimmer.lastFolder';
const VIDEO_SORT_SETTING = 'videoTrimmer.videoSort';
const AUDIO_TRACKS_SETTING = 'videoTrimmer.audioTrackSelections';
const SORT_OPTIONS = new Set([
    'name-asc',
    'name-desc',
    'duration-asc',
    'duration-desc',
    'size-desc',
    'size-asc'
]);
const MIN_TRIM_SECONDS = 0.1;
const KEYFRAME_SEEK_EPSILON = 0.05;

// Helper function to format time
function formatTime(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = (seconds % 60).toFixed(1);
    if (hrs > 0) {
        return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatDurationTime(seconds) {
    if (!Number.isFinite(seconds)) {
        return 'Unknown duration';
    }

    const totalSeconds = Math.max(0, Math.floor(seconds));
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    return [
        hrs.toString().padStart(2, '0'),
        mins.toString().padStart(2, '0'),
        secs.toString().padStart(2, '0')
    ].join(':');
}

function formatEditableTime(seconds) {
    if (!Number.isFinite(seconds)) {
        return '00:00:00';
    }

    const total = Math.max(0, seconds);
    const hrs = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    const hasFraction = Math.abs(secs - Math.floor(secs)) > 0.001;
    const secStr = hasFraction
        ? secs.toFixed(1).padStart(4, '0')
        : Math.floor(secs).toString().padStart(2, '0');

    return [
        hrs.toString().padStart(2, '0'),
        mins.toString().padStart(2, '0'),
        secStr
    ].join(':');
}

function parseTimeInput(value) {
    const trimmed = String(value).trim();

    if (!trimmed) {
        return NaN;
    }

    if (/^\d+(\.\d+)?$/.test(trimmed)) {
        return parseFloat(trimmed);
    }

    const parts = trimmed.split(':');

    if (parts.length === 2) {
        const mins = Number(parts[0]);
        const secs = Number(parts[1]);

        if (!Number.isFinite(mins) || !Number.isFinite(secs) || mins < 0 || secs < 0) {
            return NaN;
        }

        return (mins * 60) + secs;
    }

    if (parts.length === 3) {
        const hrs = Number(parts[0]);
        const mins = Number(parts[1]);
        const secs = Number(parts[2]);

        if (!Number.isFinite(hrs) || !Number.isFinite(mins) || !Number.isFinite(secs) || hrs < 0 || mins < 0 || secs < 0) {
            return NaN;
        }

        if (mins >= 60 || secs >= 60) {
            return NaN;
        }

        return (hrs * 3600) + (mins * 60) + secs;
    }

    return NaN;
}

function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) {
        return '';
    }

    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function toFileUrl(filePath) {
    return encodeURI(`file:///${filePath.replace(/\\/g, '/')}`);
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function getTimePercent(time) {
    if (!videoDuration) {
        return 0;
    }

    return clamp((time / videoDuration) * 100, 0, 100);
}

function getSliderTime(event) {
    const rect = trimSlider.getBoundingClientRect();
    const percent = clamp((event.clientX - rect.left) / rect.width, 0, 1);

    return percent * videoDuration;
}

function updatePlayPauseButton() {
    const isPaused = videoPlayer.paused;

    playPauseBtn.textContent = isPaused ? '▶' : '❚❚';
    playPauseBtn.setAttribute('aria-label', isPaused ? 'Play video' : 'Pause video');
    playPauseBtn.title = isPaused ? 'Play' : 'Pause';
}

function togglePlayback() {
    if (!currentVideoPath) {
        updateStatus('Please load a video first', 'error');
        return;
    }

    if (videoPlayer.paused) {
        videoPlayer.play().catch((error) => {
            console.error('Error playing video:', error);
            updateStatus('Could not play video', 'error');
        });
    } else {
        videoPlayer.pause();
    }
}

function syncTimeInputs() {
    startTimeInput.value = formatEditableTime(startTime);
    endTimeInput.value = formatEditableTime(endTime);
}

function updateTrimSlider() {
    const startPercent = getTimePercent(startTime);
    const endPercent = getTimePercent(endTime);

    selectedRange.style.left = `${startPercent}%`;
    selectedRange.style.right = `${100 - endPercent}%`;
    startHandle.style.left = `${startPercent}%`;
    endHandle.style.left = `${endPercent}%`;
    updatePlayheadMarker();
}

function updateTimelineTimeLabel(time) {
    if (!timelineTooltip) {
        return;
    }

    if (!currentVideoPath || !videoDuration) {
        timelineTooltip.classList.remove('visible');
        return;
    }

    const clampedTime = clamp(time, 0, videoDuration);

    timelineTooltip.textContent = formatEditableTime(clampedTime);
    timelineTooltip.style.left = `${getTimePercent(clampedTime)}%`;
    timelineTooltip.classList.add('visible');
}

function updatePlayheadMarker(time = videoPlayer.currentTime || 0) {
    playheadMarker.style.left = `${getTimePercent(time)}%`;
    updateTimelineTimeLabel(time);
}

function applyVideoSeek(targetTime) {
    const clampedTime = clamp(targetTime, 0, videoDuration);

    if (Math.abs(videoPlayer.currentTime - clampedTime) <= 0.02) {
        updatePlayheadMarker(clampedTime);
        return;
    }

    const useFastSeek = !isScrubbingTimeline
        && !isTrimHandlePreviewing
        && typeof videoPlayer.fastSeek === 'function';

    if (useFastSeek) {
        try {
            videoPlayer.fastSeek(clampedTime);
        } catch (error) {
            videoPlayer.currentTime = clampedTime;
        }
    } else {
        videoPlayer.currentTime = clampedTime;
    }

    updatePlayheadMarker(clampedTime);
}

function startPlayheadLoop() {
    stopPlayheadLoop();

    const update = () => {
        updatePlayheadMarker();

        if (!videoPlayer.paused && !videoPlayer.ended) {
            playheadAnimationFrame = requestAnimationFrame(update);
        }
    };

    update();
}

function stopPlayheadLoop() {
    if (playheadAnimationFrame !== null) {
        cancelAnimationFrame(playheadAnimationFrame);
        playheadAnimationFrame = null;
    }
}

function renderLosslessCutPoints() {
    keyframeMarkers.innerHTML = '';

    if (!videoDuration || losslessCutPoints.length === 0) {
        return;
    }

    const fragment = document.createDocumentFragment();

    losslessCutPoints.forEach((time) => {
        const marker = document.createElement('div');
        marker.className = 'keyframe-marker';
        marker.style.left = `${getTimePercent(time)}%`;
        marker.title = `Lossless cut point: ${formatTime(time)}`;
        fragment.appendChild(marker);
    });

    keyframeMarkers.appendChild(fragment);
}

function beginTrimHandlePreview() {
    if (!currentVideoPath) {
        return;
    }

    isTrimHandlePreviewing = true;
    videoPlayer.pause();
    updatePlayPauseButton();
    stopPlayheadLoop();
}

function endTrimHandlePreview() {
    flushScrubPreviewSeek();
    isTrimHandlePreviewing = false;
    scrubPreviewTime = null;
    cancelPendingPreviewSeek();
}

function cancelPendingPreviewSeek() {
    pendingPreviewTime = null;

    if (previewSeekRaf !== null) {
        cancelAnimationFrame(previewSeekRaf);
        previewSeekRaf = null;
    }
}

function previewVideoAt(time, { force = false } = {}) {
    if (!currentVideoPath || !videoDuration) {
        return;
    }

    const targetTime = clamp(time, 0, videoDuration);
    const isScrubbing = isScrubbingTimeline || isTrimHandlePreviewing;

    if (isScrubbing) {
        scrubPreviewTime = targetTime;
        updatePlayheadMarker(targetTime);

        const now = performance.now();
        const intervalElapsed = now - lastVideoSeekAt >= SCRUB_SEEK_MIN_INTERVAL_MS;
        const canSeekNow = force || (!videoPlayer.seeking && intervalElapsed);

        if (canSeekNow) {
            lastVideoSeekAt = now;
            applyVideoSeek(targetTime);
        }

        return;
    }

    pendingPreviewTime = targetTime;

    if (previewSeekRaf !== null) {
        return;
    }

    previewSeekRaf = requestAnimationFrame(() => {
        previewSeekRaf = null;
        const seekTime = pendingPreviewTime;
        pendingPreviewTime = null;

        if (!Number.isFinite(seekTime)) {
            return;
        }

        applyVideoSeek(seekTime);

        if (pendingPreviewTime !== null) {
            previewVideoAt(pendingPreviewTime);
            return;
        }

        if (!videoPlayer.paused) {
            startPlayheadLoop();
        }
    });
}

function flushScrubPreviewSeek() {
    if (!Number.isFinite(scrubPreviewTime)) {
        return;
    }

    previewVideoAt(scrubPreviewTime, { force: true });
}

function setStartTime(time, seekVideo = false) {
    startTime = clamp(time, 0, Math.max(0, endTime - MIN_TRIM_SECONDS));
    syncTimeInputs();
    updateTrimSlider();

    if (seekVideo) {
        previewVideoAt(startTime);
    }
}

function setEndTime(time, seekVideo = false) {
    endTime = clamp(time, Math.min(videoDuration, startTime + MIN_TRIM_SECONDS), videoDuration);
    syncTimeInputs();
    updateTrimSlider();

    if (seekVideo) {
        previewVideoAt(endTime);
    }
}

function updateTimeFromInput(type) {
    const input = type === 'start' ? startTimeInput : endTimeInput;
    const value = parseTimeInput(input.value);

    if (!Number.isFinite(value)) {
        syncTimeInputs();
        updateStatus('Invalid time. Use HH:MM:SS (e.g. 00:01:30)', 'error');
        return;
    }

    if (type === 'start') {
        setStartTime(value);
    } else {
        setEndTime(value);
    }
}

function updateActiveTrimHandle(event) {
    if (!activeTrimHandle || !videoDuration) {
        return;
    }

    const time = getSliderTime(event);

    if (activeTrimHandle === 'start') {
        setStartTime(time, true);
    } else {
        setEndTime(time, true);
    }
}

function beginTrimHandleDrag(handle, event) {
    if (!currentVideoPath || !videoDuration) {
        return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    beginTrimHandlePreview();
    activeTrimHandle = handle;
    updateActiveTrimHandle(event);
}

function stopTrimHandleDrag() {
    if (activeTrimHandle) {
        endTrimHandlePreview();
    }

    activeTrimHandle = null;
}

function seekTimeline(event) {
    if (!currentVideoPath || !videoDuration) {
        return;
    }

    if (event.target === startHandle || event.target === endHandle) {
        return;
    }

    previewVideoAt(getSliderTime(event));
}

function beginTimelineScrub(event) {
    if (!currentVideoPath || !videoDuration) {
        return;
    }

    if (event.target === startHandle || event.target === endHandle) {
        return;
    }

    event.preventDefault();
    trimSlider.setPointerCapture(event.pointerId);
    isScrubbingTimeline = true;
    scrubPreviewTime = null;
    videoPlayer.pause();
    stopPlayheadLoop();
    updatePlayPauseButton();
    seekTimeline(event);
}

function updateTimelineScrub(event) {
    if (!isScrubbingTimeline) {
        return;
    }

    seekTimeline(event);
}

function stopTimelineScrub() {
    if (isScrubbingTimeline) {
        flushScrubPreviewSeek();
    }

    isScrubbingTimeline = false;
    scrubPreviewTime = null;
    cancelPendingPreviewSeek();
}

function seekKeyframe(direction) {
    if (!currentVideoPath || losslessCutPoints.length === 0) {
        updateStatus('No keyframes loaded for this video', 'error');
        return;
    }

    const currentTime = videoPlayer.currentTime || 0;
    const targetKeyframe = direction === 'next'
        ? losslessCutPoints.find((time) => time > currentTime + KEYFRAME_SEEK_EPSILON)
        : [...losslessCutPoints].reverse().find((time) => time < currentTime - KEYFRAME_SEEK_EPSILON);

    if (!Number.isFinite(targetKeyframe)) {
        updateStatus(`No ${direction} keyframe`, 'info');
        return;
    }

    videoPlayer.currentTime = targetKeyframe;
    updatePlayheadMarker();
}

function formatFilenameTime(seconds) {
    const totalSeconds = Math.max(0, Math.floor(seconds));
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    return [
        hrs.toString().padStart(2, '0'),
        mins.toString().padStart(2, '0'),
        secs.toString().padStart(2, '0')
    ].join('.');
}

function getFileName(filePath) {
    return filePath.split(/[\\/]/).pop() || 'trimmed_video.mp4';
}

function buildDefaultSaveName(inputPath, start, end) {
    const fileName = getFileName(inputPath);
    const extensionIndex = fileName.lastIndexOf('.');
    const name = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;
    const extension = extensionIndex > 0 ? fileName.slice(extensionIndex) : '.mp4';

    if (!settings.appendCutTimes) {
        return `trimmed_${fileName}`;
    }

    return `${name} ${formatFilenameTime(start)} - ${formatFilenameTime(end)}${extension}`;
}

function buildScreenshotFileName(inputPath, timeSeconds) {
    const fileName = getFileName(inputPath);
    const extensionIndex = fileName.lastIndexOf('.');
    const name = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;
    const timeLabel = formatEditableTime(timeSeconds).replace(/:/g, '.');

    return `${name} ${timeLabel}.png`;
}

function captureVideoFrameDataUrl() {
    const width = videoPlayer.videoWidth;
    const height = videoPlayer.videoHeight;

    if (!width || !height) {
        throw new Error('Video frame is not ready');
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');

    if (!context) {
        throw new Error('Could not capture screenshot');
    }

    context.drawImage(videoPlayer, 0, 0, width, height);
    return canvas.toDataURL('image/png');
}

async function resolveScreenshotSavePath(inputPath, timeSeconds) {
    const fileName = buildScreenshotFileName(inputPath, timeSeconds);

    if (settings.autoSaveEnabled) {
        if (!settings.autoSaveFolder) {
            updateStatus('Choose an auto-save folder in Settings first', 'error');
            return null;
        }

        return window.electronAPI.resolveSavePath({
            directory: settings.autoSaveFolder,
            fileName
        });
    }

    return window.electronAPI.screenshotSaveDialog({
        defaultPath: fileName
    });
}

async function saveScreenshot() {
    if (!currentVideoPath) {
        updateStatus('Please load a video first', 'error');
        return;
    }

    if (videoPlayer.readyState < 2) {
        updateStatus('Video is not ready for a screenshot yet', 'error');
        return;
    }

    let imageData;

    try {
        imageData = captureVideoFrameDataUrl();
    } catch (error) {
        console.error('Error capturing screenshot:', error);
        updateStatus(error.message || 'Could not capture screenshot', 'error');
        return;
    }

    const savePath = await resolveScreenshotSavePath(currentVideoPath, videoPlayer.currentTime);

    if (!savePath) {
        if (!settings.autoSaveEnabled) {
            updateStatus('Screenshot save cancelled', 'info');
        }

        return;
    }

    try {
        const result = await window.electronAPI.saveScreenshot({
            filePath: savePath,
            imageData
        });

        if (result.success) {
            const sizeMb = (result.size / (1024 * 1024)).toFixed(2);
            updateStatus(`Screenshot saved to ${savePath} (${sizeMb} MB)`, 'success');
        }
    } catch (error) {
        console.error('Error saving screenshot:', error);
        updateStatus('Error saving screenshot: ' + (error.message || 'Unknown error'), 'error');
    }
}

async function resolveTrimSavePath(inputPath, start, end) {
    const fileName = buildDefaultSaveName(inputPath, start, end);

    if (settings.autoSaveEnabled) {
        if (!settings.autoSaveFolder) {
            updateStatus('Choose an auto-save folder in Settings first', 'error');
            return null;
        }

        return window.electronAPI.resolveSavePath({
            directory: settings.autoSaveFolder,
            fileName
        });
    }

    return window.electronAPI.saveDialog({
        defaultPath: fileName
    });
}

function loadSettings() {
    const savedAppendCutTimes = localStorage.getItem(APPEND_CUT_TIMES_SETTING);
    const savedRememberLastFolder = localStorage.getItem(REMEMBER_LAST_FOLDER_SETTING);
    const savedShowDeleteOption = localStorage.getItem(SHOW_DELETE_OPTION_SETTING);
    const savedAutoAdvance = localStorage.getItem(AUTO_ADVANCE_SETTING);
    const savedDarkMode = localStorage.getItem(DARK_MODE_SETTING);
    const savedAutoSaveEnabled = localStorage.getItem(AUTO_SAVE_ENABLED_SETTING);
    const savedAutoSaveFolder = localStorage.getItem(AUTO_SAVE_FOLDER_SETTING);
    const savedPromptDeleteSource = localStorage.getItem(PROMPT_DELETE_SOURCE_SETTING);
    const savedShowNotifications = localStorage.getItem(SHOW_NOTIFICATIONS_SETTING);

    settings.appendCutTimes = savedAppendCutTimes === null
        ? true
        : savedAppendCutTimes === 'true';
    settings.rememberLastFolder = savedRememberLastFolder === 'true';
    settings.showDeleteOption = savedShowDeleteOption === null
        ? true
        : savedShowDeleteOption === 'true';
    settings.autoAdvance = savedAutoAdvance === 'true';
    settings.darkMode = savedDarkMode === 'true';
    settings.autoSaveEnabled = savedAutoSaveEnabled === 'true';
    settings.autoSaveFolder = savedAutoSaveFolder || '';
    settings.promptDeleteSourceAfterTrim = savedPromptDeleteSource === 'true';
    settings.showNotifications = savedShowNotifications === 'true';

    applyTheme();
    loadSortPreference();
    window.electronAPI.updateMenuSettings(settings);
}

function applyTheme() {
    document.documentElement.dataset.theme = settings.darkMode ? 'dark' : 'light';
}

function loadSortPreference() {
    const savedSort = localStorage.getItem(VIDEO_SORT_SETTING);

    if (savedSort && SORT_OPTIONS.has(savedSort)) {
        videoSortSelect.value = savedSort;
    }
}

function saveSortPreference() {
    localStorage.setItem(VIDEO_SORT_SETTING, videoSortSelect.value);
}

function saveSettings() {
    localStorage.setItem(APPEND_CUT_TIMES_SETTING, settings.appendCutTimes.toString());
    localStorage.setItem(REMEMBER_LAST_FOLDER_SETTING, settings.rememberLastFolder.toString());
    localStorage.setItem(SHOW_DELETE_OPTION_SETTING, settings.showDeleteOption.toString());
    localStorage.setItem(AUTO_ADVANCE_SETTING, settings.autoAdvance.toString());
    localStorage.setItem(DARK_MODE_SETTING, settings.darkMode.toString());
    localStorage.setItem(AUTO_SAVE_ENABLED_SETTING, settings.autoSaveEnabled.toString());
    localStorage.setItem(AUTO_SAVE_FOLDER_SETTING, settings.autoSaveFolder);
    localStorage.setItem(PROMPT_DELETE_SOURCE_SETTING, settings.promptDeleteSourceAfterTrim.toString());
    localStorage.setItem(SHOW_NOTIFICATIONS_SETTING, settings.showNotifications.toString());

    if (settings.rememberLastFolder && currentFolderPath) {
        localStorage.setItem(LAST_FOLDER_SETTING, currentFolderPath);
    }

    if (!settings.rememberLastFolder) {
        localStorage.removeItem(LAST_FOLDER_SETTING);
    }
}

function setSetting(key, value, updateMenu = true) {
    settings[key] = value;
    saveSettings();

    if (key === 'darkMode') {
        applyTheme();
    } else if (key === 'showNotifications' && !value && toastContainer) {
        [...toastContainer.querySelectorAll('.toast')].forEach((toast) => dismissToast(toast));
    } else {
        renderLoadedVideoInfo();
        refreshFolderLibrary();
    }

    if (updateMenu) {
        window.electronAPI.updateMenuSettings(settings);
    }
}

function dismissToast(toast) {
    if (!toast || toast.classList.contains('dismissed')) {
        return;
    }

    clearTimeout(toast._dismissTimer);
    toast.classList.remove('visible');
    toast.classList.add('dismissed');
    setTimeout(() => toast.remove(), 280);
}

function updateStatus(message, type = 'info') {
    if (!toastContainer || !message || !settings.showNotifications) {
        return;
    }

    const toast = document.createElement('div');
    const messageEl = document.createElement('p');
    const closeButton = document.createElement('button');

    toast.className = `toast ${type}`;
    toast.dataset.toastId = String(++toastIdCounter);
    messageEl.className = 'toast-message';
    messageEl.textContent = message;
    closeButton.type = 'button';
    closeButton.className = 'toast-close';
    closeButton.setAttribute('aria-label', 'Dismiss notification');
    closeButton.textContent = '×';
    closeButton.addEventListener('click', () => dismissToast(toast));

    toast.appendChild(messageEl);
    toast.appendChild(closeButton);
    toastContainer.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.add('visible');
    });

    toast._dismissTimer = setTimeout(() => dismissToast(toast), TOAST_DURATION_MS);
}

function getVideoDurationLabel() {
    const seconds = Number.isFinite(videoDuration) && videoDuration > 0
        ? videoDuration
        : currentVideo?.duration;

    if (!Number.isFinite(seconds) || seconds <= 0) {
        return '';
    }

    return formatDurationTime(seconds);
}

async function loadLosslessCutPoints() {
    const videoPath = currentVideoPath;
    losslessCutPoints = [];
    keyframeMarkers.innerHTML = '';

    if (!videoPath) {
        return;
    }

    try {
        const videoInfo = await window.electronAPI.getVideoInfo(videoPath);

        if (videoPath !== currentVideoPath) {
            return;
        }

        if (Number.isFinite(videoInfo.duration) && videoInfo.duration > 0) {
            videoDuration = videoInfo.duration;
            renderLoadedVideoInfo();
        }

        losslessCutPoints = videoInfo.keyframes || [];
        renderLosslessCutPoints();
        updateTrimSlider();
    } catch (error) {
        console.error('Error loading lossless cut points:', error);
        updateStatus('Video loaded, but lossless cut points could not be shown', 'error');
    }
}

function highlightSelectedFolderVideo() {
    const cards = videoGrid.querySelectorAll('.video-card');

    cards.forEach((card) => {
        card.classList.toggle('selected', card.dataset.path === currentVideoPath);
    });
}

function renderLoadedVideoInfo() {
    if (!currentVideo) {
        fileInfo.innerHTML = `
            <div class="file-info-body">
                <h3>No Video Loaded</h3>
                <p>Open a folder or select a video file to begin.</p>
            </div>
        `;
        return;
    }

    const durationLabel = getVideoDurationLabel();
    const audioLabel = currentAudioTracks.length > 1
        ? ` · ${currentAudioTracks.length} audio tracks`
        : '';

    fileInfo.innerHTML = `
        <div class="file-info-body">
            <h3>Loaded Video</h3>
            <p><strong>${currentVideo.name}</strong> · ${formatBytes(currentVideo.size)}${durationLabel ? ` · ${durationLabel}` : ''}${audioLabel}</p>
        </div>
    `;
}

function loadAudioTrackSelections() {
    try {
        const stored = localStorage.getItem(AUDIO_TRACKS_SETTING);
        audioTrackSelectionsByPath = stored ? JSON.parse(stored) : {};
    } catch (error) {
        console.error('Could not load audio track selections:', error);
        audioTrackSelectionsByPath = {};
    }
}

function saveAudioTrackSelections() {
    localStorage.setItem(AUDIO_TRACKS_SETTING, JSON.stringify(audioTrackSelectionsByPath));
}

function getAllAudioTrackIndexes(tracks) {
    return tracks.map((track) => track.index);
}

function getSavedAudioTrackIndexes(path, tracks) {
    if (!tracks.length) {
        return [];
    }

    const saved = audioTrackSelectionsByPath[path];

    if (!Array.isArray(saved) || !saved.length) {
        return getAllAudioTrackIndexes(tracks);
    }

    const validIndexes = new Set(tracks.map((track) => track.index));
    const filtered = saved.filter((index) => validIndexes.has(index));

    return filtered.length ? filtered : getAllAudioTrackIndexes(tracks);
}

function formatAudioTrackLabel(track) {
    const parts = [`Track ${track.trackNumber}`];

    if (track.title) {
        parts.push(track.title);
    }

    if (track.language) {
        parts.push(track.language.toUpperCase());
    }

    return parts.join(' · ');
}

function formatAudioTrackMeta(track) {
    const parts = [`Stream ${track.index}`];

    if (track.codec) {
        parts.push(track.codec.toUpperCase());
    }

    if (track.channels) {
        parts.push(`${track.channels} ch`);
    }

    return parts.join(' · ');
}

function updateAudioTracksButton() {
    const hasMultiple = currentAudioTracks.length > 1;

    audioTracksBtn.hidden = !hasMultiple;

    if (!hasMultiple) {
        return;
    }

    const selectedCount = selectedAudioTrackIndexes.length;
    const total = currentAudioTracks.length;

    audioTracksBtn.textContent = selectedCount === total
        ? `Audio (${total})`
        : `Audio (${selectedCount}/${total})`;
}

function openAudioTracksModal() {
    if (currentAudioTracks.length <= 1) {
        return;
    }

    renderAudioTracksList(selectedAudioTrackIndexes);
    audioTracksModal.classList.add('open');
    audioTracksModal.setAttribute('aria-hidden', 'false');
}

function closeAudioTracksModal() {
    audioTracksModal.classList.remove('open');
    audioTracksModal.setAttribute('aria-hidden', 'true');
}

function renderAudioTracksList(selectedIndexes) {
    const selectedSet = new Set(selectedIndexes);

    audioTracksList.innerHTML = '';

    currentAudioTracks.forEach((track) => {
        const option = document.createElement('label');
        const checkbox = document.createElement('input');
        const details = document.createElement('div');
        const title = document.createElement('span');
        const meta = document.createElement('span');

        option.className = 'audio-track-option';
        checkbox.type = 'checkbox';
        checkbox.value = String(track.index);
        checkbox.checked = selectedSet.has(track.index);

        details.className = 'audio-track-details';
        title.className = 'audio-track-title';
        title.textContent = formatAudioTrackLabel(track);
        meta.className = 'audio-track-meta';
        meta.textContent = formatAudioTrackMeta(track);

        details.appendChild(title);
        details.appendChild(meta);
        option.appendChild(checkbox);
        option.appendChild(details);
        audioTracksList.appendChild(option);
    });
}

function getModalSelectedAudioTrackIndexes() {
    return [...audioTracksList.querySelectorAll('input[type="checkbox"]')]
        .filter((checkbox) => checkbox.checked)
        .map((checkbox) => Number(checkbox.value));
}

function applyAudioTracksFromModal() {
    const selected = getModalSelectedAudioTrackIndexes();

    if (!selected.length) {
        updateStatus('Select at least one audio track for export', 'error');
        return;
    }

    selectedAudioTrackIndexes = selected;

    if (currentVideoPath) {
        audioTrackSelectionsByPath[currentVideoPath] = selected;
        saveAudioTrackSelections();
    }

    updateAudioTracksButton();
    closeAudioTracksModal();
    updateStatus(`${selected.length} audio track${selected.length === 1 ? '' : 's'} selected for export`, 'success');
}

function selectAllAudioTracksInModal() {
    audioTracksList.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
        checkbox.checked = true;
    });
}

function getLibrarySearchQuery() {
    return librarySearch.value.trim().toLowerCase();
}

function filterFolderVideosBySearch(videos) {
    const query = getLibrarySearchQuery();

    if (!query) {
        return videos;
    }

    return videos.filter((video) => video.name.toLowerCase().includes(query));
}

function getSortedFolderVideos() {
    const videos = [...folderVideos];

    return videos.sort((a, b) => {
        switch (videoSortSelect.value) {
            case 'name-desc':
                return b.name.localeCompare(a.name);
            case 'duration-asc':
                return (a.duration ?? Number.POSITIVE_INFINITY) - (b.duration ?? Number.POSITIVE_INFINITY);
            case 'duration-desc':
                return (b.duration ?? Number.NEGATIVE_INFINITY) - (a.duration ?? Number.NEGATIVE_INFINITY);
            case 'size-asc':
                return a.size - b.size;
            case 'size-desc':
                return b.size - a.size;
            case 'name-asc':
            default:
                return a.name.localeCompare(b.name);
        }
    });
}

function getVisibleFolderVideos() {
    return filterFolderVideosBySearch(getSortedFolderVideos());
}

function updateFolderSummary() {
    const total = folderVideos.length;
    const visible = getVisibleFolderVideos().length;
    const query = getLibrarySearchQuery();

    if (total === 0) {
        folderSummary.textContent = currentFolderPath
            ? 'No supported videos found in this folder.'
            : 'No folder selected.';
        return;
    }

    if (currentFolderPath) {
        let summary = `${total} video${total === 1 ? '' : 's'} in ${currentFolderPath}`;

        if (query) {
            summary = `${visible} of ${total} match "${librarySearch.value.trim()}"`;
        }

        folderSummary.textContent = summary;
        return;
    }

    if (total === 1) {
        folderSummary.textContent = query
            ? `${visible} of 1 match "${librarySearch.value.trim()}"`
            : '1 selected video file';
        return;
    }

    let summary = `${total} videos`;

    if (query) {
        summary = `${visible} of ${total} match "${librarySearch.value.trim()}"`;
    }

    folderSummary.textContent = summary;
}

function refreshFolderLibrary() {
    updateFolderSummary();
    renderFolderVideos(getVisibleFolderVideos());
}

function clearLibrarySearch() {
    librarySearch.value = '';
}

async function openVideo(video) {
    currentVideo = video;
    currentVideoPath = video.path;

    let playbackPath = currentVideoPath;

    try {
        const playbackSource = await window.electronAPI.getPlaybackSource(currentVideoPath);
        playbackPath = playbackSource.playbackPath || currentVideoPath;
        currentAudioTracks = playbackSource.audioTracks || [];
        currentVideoStreamIndex = Number.isFinite(Number(playbackSource.videoStreamIndex))
            ? Number(playbackSource.videoStreamIndex)
            : 0;
    } catch (error) {
        console.error('Error loading playback source:', error);
        currentAudioTracks = [];
        currentVideoStreamIndex = 0;
    }

    selectedAudioTrackIndexes = getSavedAudioTrackIndexes(currentVideoPath, currentAudioTracks);
    updateAudioTracksButton();

    videoPlayer.src = toFileUrl(playbackPath);
    videoPlayer.load();
    renderLoadedVideoInfo();

    highlightSelectedFolderVideo();

    videoPlayer.onloadedmetadata = () => {
        videoDuration = videoPlayer.duration;
        endTime = videoDuration;
        startTime = 0;
        syncTimeInputs();
        renderLosslessCutPoints();
        updateTrimSlider();
        updatePlayPauseButton();
        renderLoadedVideoInfo();
        updateStatus(`Loaded ${video.name}`, 'success');
    };

    await loadLosslessCutPoints();
}

function renderFolderVideos(videos) {
    videoGrid.innerHTML = '';

    if (videos.length === 0) {
        if (folderVideos.length > 0 && getLibrarySearchQuery()) {
            const emptyMessage = document.createElement('p');
            emptyMessage.className = 'folder-summary';
            emptyMessage.textContent = `No videos match "${librarySearch.value.trim()}".`;
            videoGrid.appendChild(emptyMessage);
        }

        return;
    }

    const fragment = document.createDocumentFragment();

    videos.forEach((video) => {
        const card = document.createElement('div');
        const openButton = document.createElement('button');
        const thumb = video.thumbnailPath
            ? document.createElement('img')
            : document.createElement('div');
        const details = document.createElement('div');
        const title = document.createElement('div');
        const meta = document.createElement('div');
        const deleteButton = document.createElement('button');
        const duration = formatDurationTime(video.duration);

        card.className = 'video-card';
        card.dataset.path = video.path;
        openButton.type = 'button';
        openButton.className = 'video-card-main';

        if (video.thumbnailPath) {
            thumb.src = toFileUrl(video.thumbnailPath);
            thumb.alt = '';
            thumb.className = 'video-thumb';
        } else {
            thumb.className = 'video-thumb video-thumb-placeholder';
            thumb.textContent = 'Video';
        }

        title.className = 'video-card-title';
        title.textContent = video.name;
        meta.className = 'video-card-meta';
        meta.textContent = `${duration} · ${formatBytes(video.size)}`;

        details.appendChild(title);
        details.appendChild(meta);
        openButton.appendChild(thumb);
        openButton.appendChild(details);
        openButton.addEventListener('click', () => openVideo(video));
        card.appendChild(openButton);

        if (settings.showDeleteOption) {
            deleteButton.type = 'button';
            deleteButton.className = 'video-delete-button';
            deleteButton.innerHTML = '<span class="video-delete-icon" aria-hidden="true">×</span>';
            deleteButton.setAttribute('aria-label', `Delete ${video.name}`);
            deleteButton.title = 'Delete video';
            deleteButton.addEventListener('click', () => deleteVideo(video));
            card.appendChild(deleteButton);
        }

        fragment.appendChild(card);
    });

    videoGrid.appendChild(fragment);
    highlightSelectedFolderVideo();
}

function clearCurrentVideo() {
    videoPlayer.pause();
    videoPlayer.removeAttribute('src');
    videoPlayer.load();

    currentVideo = null;
    currentVideoPath = null;
    currentAudioTracks = [];
    selectedAudioTrackIndexes = [];
    currentVideoStreamIndex = 0;
    videoDuration = 0;
    startTime = 0;
    endTime = 0;
    losslessCutPoints = [];
    keyframeMarkers.innerHTML = '';

    syncTimeInputs();
    updateTrimSlider();
    updatePlayPauseButton();
    updateAudioTracksButton();
    closeAudioTracksModal();
    renderLoadedVideoInfo();
    highlightSelectedFolderVideo();
}

async function deleteVideo(video) {
    const wasCurrentVideo = video.path === currentVideoPath;

    if (wasCurrentVideo) {
        videoPlayer.pause();
        videoPlayer.removeAttribute('src');
        videoPlayer.load();
    }

    try {
        const result = await window.electronAPI.deleteVideo(video.path);

        if (!result.deleted) {
            if (wasCurrentVideo) {
                await openVideo(video);
            }
            updateStatus('Delete cancelled', 'info');
            return;
        }

        folderVideos = folderVideos.filter((folderVideo) => folderVideo.path !== video.path);
        refreshFolderLibrary();

        if (wasCurrentVideo) {
            clearCurrentVideo();
        }

        updateStatus(`Moved ${video.name} to the Recycle Bin`, 'success');
    } catch (error) {
        if (wasCurrentVideo) {
            await openVideo(video);
        }
        console.error('Error deleting video:', error);
        updateStatus('Error deleting video: ' + (error.message || 'Unknown error'), 'error');
    }
}

async function loadVideo() {
    try {
        const video = await window.electronAPI.selectVideo();

        if (!video) {
            updateStatus('File selection cancelled', 'info');
            return;
        }

        currentFolderPath = null;
        folderVideos = [video];
        clearLibrarySearch();
        refreshFolderLibrary();
        await openVideo(video);
    } catch (error) {
        console.error('Error loading video:', error);
        updateStatus('Error loading video: ' + (error.message || 'Unknown error'), 'error');
    }
}

async function loadVideoFolder(folderPath = null) {
    updateStatus('Loading folder thumbnails...', 'info');

    try {
        const result = await window.electronAPI.selectVideoFolder(folderPath);

        if (!result) {
            updateStatus('Folder selection cancelled', 'info');
            return;
        }

        await applyFolderLibraryResult(result);

        if (settings.rememberLastFolder && result.folderPath) {
            localStorage.setItem(LAST_FOLDER_SETTING, result.folderPath);
        }
    } catch (error) {
        console.error('Error loading folder:', error);
        updateStatus('Error loading folder: ' + (error.message || 'Unknown error'), 'error');
    }
}

async function applyFolderLibraryResult(result) {
    folderVideos = result.videos || [];
    currentFolderPath = result.folderPath || null;
    clearLibrarySearch();
    refreshFolderLibrary();

    if (!currentVideoPath && folderVideos.length > 0) {
        await openVideo(getVisibleFolderVideos()[0] || folderVideos[0]);
    }
}

async function loadDroppedItems(paths) {
    if (!paths.length) {
        return;
    }

    updateStatus('Loading dropped items...', 'info');

    try {
        const result = await window.electronAPI.handleDroppedPaths(paths);

        if (!result?.videos?.length) {
            updateStatus('No supported videos in drop', 'error');
            return;
        }

        await applyFolderLibraryResult(result);

        if (settings.rememberLastFolder && result.folderPath) {
            localStorage.setItem(LAST_FOLDER_SETTING, result.folderPath);
        }

        const count = result.videos.length;
        updateStatus(`Loaded ${count} video${count === 1 ? '' : 's'} from drop`, 'success');
    } catch (error) {
        console.error('Error loading dropped items:', error);
        updateStatus('Error loading dropped items: ' + (error.message || 'Unknown error'), 'error');
    }
}

function getDroppedPaths(event) {
    return [...event.dataTransfer.files]
        .map((file) => file.path)
        .filter((filePath) => typeof filePath === 'string' && filePath.length > 0);
}

function setupDragAndDrop() {
    let dragActive = false;

    window.addEventListener('dragenter', (event) => {
        event.preventDefault();

        if (!dragActive) {
            dragActive = true;
            libraryPanel.classList.add('drag-over');
        }
    });

    window.addEventListener('dragover', (event) => {
        event.preventDefault();

        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'copy';
        }
    });

    window.addEventListener('dragleave', (event) => {
        if (
            event.clientX <= 0
            || event.clientY <= 0
            || event.clientX >= window.innerWidth
            || event.clientY >= window.innerHeight
        ) {
            dragActive = false;
            libraryPanel.classList.remove('drag-over');
        }
    });

    window.addEventListener('drop', async (event) => {
        event.preventDefault();
        dragActive = false;
        libraryPanel.classList.remove('drag-over');
        await loadDroppedItems(getDroppedPaths(event));
    });
}

async function restoreLastFolder() {
    const lastFolder = localStorage.getItem(LAST_FOLDER_SETTING);

    if (settings.rememberLastFolder && lastFolder) {
        await loadVideoFolder(lastFolder);
    }
}

// Set start time
function setStart() {
    if (!currentVideoPath) {
        updateStatus('Please load a video first', 'error');
        return;
    }
    setStartTime(videoPlayer.currentTime);
    updateStatus(`Start time set to ${formatEditableTime(startTime)}`, 'success');
}

// Set end time
function setEnd() {
    if (!currentVideoPath) {
        updateStatus('Please load a video first', 'error');
        return;
    }
    setEndTime(videoPlayer.currentTime);
    updateStatus(`End time set to ${formatEditableTime(endTime)}`, 'success');
}

// Reset times
function resetTimes() {
    startTime = 0;
    endTime = videoDuration;
    syncTimeInputs();
    updateTrimSlider();
    videoPlayer.currentTime = 0;
    updateStatus('Times reset', 'info');
}

function seekBySeconds(delta) {
    if (!currentVideoPath || !videoDuration) {
        return;
    }

    videoPlayer.currentTime = clamp(videoPlayer.currentTime + delta, 0, videoDuration);
    updatePlayheadMarker();
}

function runShortcutAction(action) {
    switch (action) {
        case 'open-file':
            loadVideo();
            break;
        case 'open-folder':
            loadVideoFolder();
            break;
        case 'trim':
            trimVideo();
            break;
        case 'play-pause':
            togglePlayback();
            break;
        case 'set-start':
            setStart();
            break;
        case 'set-end':
            setEnd();
            break;
        case 'reset':
            resetTimes();
            break;
        case 'prev-keyframe':
            seekKeyframe('previous');
            break;
        case 'next-keyframe':
            seekKeyframe('next');
            break;
        case 'seek-back':
            seekBySeconds(-1);
            break;
        case 'seek-forward':
            seekBySeconds(1);
            break;
        default:
            break;
    }
}

function isEditableTarget(target) {
    if (!target) {
        return false;
    }

    const tag = target.tagName;

    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function handlePlaybackShortcut(event) {
    if (event.defaultPrevented || isEditableTarget(event.target)) {
        return;
    }

    if (event.ctrlKey || event.altKey || event.metaKey) {
        return;
    }

    if (event.shiftKey && event.key === 'ArrowLeft') {
        event.preventDefault();
        runShortcutAction('seek-back');
        return;
    }

    if (event.shiftKey && event.key === 'ArrowRight') {
        event.preventDefault();
        runShortcutAction('seek-forward');
        return;
    }

    if (event.shiftKey) {
        return;
    }

    switch (event.key) {
        case ' ':
            event.preventDefault();
            runShortcutAction('play-pause');
            break;
        case 'i':
        case 'I':
            runShortcutAction('set-start');
            break;
        case 'o':
        case 'O':
            runShortcutAction('set-end');
            break;
        case 'r':
        case 'R':
            runShortcutAction('reset');
            break;
        case ',':
            runShortcutAction('prev-keyframe');
            break;
        case '.':
            runShortcutAction('next-keyframe');
            break;
        default:
            break;
    }
}

async function advanceToNextVideo() {
    const nextVideo = getNextFolderVideo();

    if (!nextVideo) {
        return false;
    }

    await openVideo(nextVideo);
    return true;
}

function getNextFolderVideo() {
    const videos = getVisibleFolderVideos();
    const currentIndex = videos.findIndex((video) => video.path === currentVideoPath);

    if (currentIndex === -1 || currentIndex >= videos.length - 1) {
        return null;
    }

    return videos[currentIndex + 1];
}

async function maybePromptDeleteSourceVideo(trimmedSize) {
    if (!settings.promptDeleteSourceAfterTrim || !currentVideo) {
        return;
    }

    if (!Number.isFinite(currentVideo.size) || currentVideo.size <= trimmedSize) {
        return;
    }

    try {
        const confirmation = await window.electronAPI.confirmDeleteSource(currentVideo.path);

        if (!confirmation?.confirmed) {
            return;
        }

        await deleteVideo(currentVideo);
    } catch (error) {
        console.error('Error deleting original video:', error);
        updateStatus('Error deleting original video: ' + (error.message || 'Unknown error'), 'error');
    }
}

async function handleTrimSuccess(result, savePath) {
    const wasExpanded = result.actualStartTime < startTime || result.actualEndTime > endTime;
    const trimDetails = wasExpanded
        ? ` Lossless range: ${formatTime(result.actualStartTime)} to ${formatTime(result.actualEndTime)}.`
        : '';
    const successMessage = `Success. Video saved to ${savePath} (${(result.size / (1024 * 1024)).toFixed(2)} MB).${trimDetails}`;
    const nextVideo = settings.autoAdvance ? getNextFolderVideo() : null;

    await maybePromptDeleteSourceVideo(result.size);

    if (nextVideo) {
        await openVideo(nextVideo);
        updateStatus(`${successMessage} Loaded next clip: ${nextVideo.name}.`, 'success');
        return;
    }

    updateStatus(successMessage, 'success');
}

// Trim video
async function trimVideo() {
    if (!currentVideoPath) {
        updateStatus('Please load a video first', 'error');
        return;
    }
    
    startTime = parseTimeInput(startTimeInput.value);
    endTime = parseTimeInput(endTimeInput.value);

    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
        updateStatus('Invalid time. Use HH:MM:SS (e.g. 00:01:30)', 'error');
        return;
    }
    
    if (startTime >= endTime) {
        updateStatus('Start time must be less than end time', 'error');
        return;
    }
    
    if (endTime > videoDuration) {
        updateStatus('End time cannot exceed video duration', 'error');
        return;
    }

    if (currentAudioTracks.length > 0 && selectedAudioTrackIndexes.length === 0) {
        updateStatus('Select at least one audio track for export', 'error');
        return;
    }
    
    const savePath = await resolveTrimSavePath(currentVideoPath, startTime, endTime);

    if (!savePath) {
        if (!settings.autoSaveEnabled) {
            updateStatus('Save cancelled', 'info');
        }

        return;
    }
    
    updateStatus('Trimming video... This may take a moment', 'info');
    
    try {
        const trimPayload = {
            inputPath: currentVideoPath,
            startTime: startTime,
            endTime: endTime,
            outputPath: savePath,
            videoStreamIndex: currentVideoStreamIndex
        };

        if (currentAudioTracks.length > 0) {
            trimPayload.audioStreamIndexes = selectedAudioTrackIndexes;
        }

        const result = await window.electronAPI.trimVideo(trimPayload);
        
        if (result.success) {
            await handleTrimSuccess(result, savePath);
        }
    } catch (error) {
        console.error('Error trimming video:', error);
        updateStatus('Error trimming video: ' + (error.error || error.message || 'Unknown error'), 'error');
    }
}

// Event listeners
selectVideoBtn.addEventListener('click', loadVideo);
selectFolderBtn.addEventListener('click', () => loadVideoFolder());
librarySearch.addEventListener('input', refreshFolderLibrary);
videoSortSelect.addEventListener('change', () => {
    saveSortPreference();
    refreshFolderLibrary();
});
playPauseBtn.addEventListener('click', togglePlayback);
videoPlayer.addEventListener('click', togglePlayback);
prevKeyframeBtn.addEventListener('click', () => seekKeyframe('previous'));
nextKeyframeBtn.addEventListener('click', () => seekKeyframe('next'));
setStartBtn.addEventListener('click', setStart);
setEndBtn.addEventListener('click', setEnd);
resetBtn.addEventListener('click', resetTimes);
screenshotBtn.addEventListener('click', saveScreenshot);
audioTracksBtn.addEventListener('click', openAudioTracksModal);
audioTracksSelectAllBtn.addEventListener('click', selectAllAudioTracksInModal);
audioTracksCancelBtn.addEventListener('click', closeAudioTracksModal);
audioTracksApplyBtn.addEventListener('click', applyAudioTracksFromModal);
audioTracksModal.addEventListener('click', (event) => {
    if (event.target === audioTracksModal) {
        closeAudioTracksModal();
    }
});
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && audioTracksModal.classList.contains('open')) {
        closeAudioTracksModal();
    }
});
trimBtn.addEventListener('click', trimVideo);
window.electronAPI.onMenuSettingChanged(async ({ key, value }) => {
    if (key === 'autoSaveFolder') {
        setSetting('autoSaveFolder', value, false);
        return;
    }

    if (key === 'autoSaveEnabled' && value && !settings.autoSaveFolder) {
        const folderPath = await window.electronAPI.selectOutputFolder();

        if (!folderPath) {
            setSetting('autoSaveEnabled', false, true);
            return;
        }

        settings.autoSaveFolder = folderPath;
        setSetting('autoSaveEnabled', true, true);
        return;
    }

    setSetting(key, value, false);
});
window.electronAPI.onShortcut(runShortcutAction);
document.addEventListener('keydown', handlePlaybackShortcut);
function bindTimeInput(input, type) {
    input.addEventListener('change', () => updateTimeFromInput(type));
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            updateTimeFromInput(type);
            input.blur();
        }
    });
}

bindTimeInput(startTimeInput, 'start');
bindTimeInput(endTimeInput, 'end');
trimSlider.addEventListener('pointerdown', beginTimelineScrub);
startHandle.addEventListener('pointerdown', (event) => beginTrimHandleDrag('start', event));
endHandle.addEventListener('pointerdown', (event) => beginTrimHandleDrag('end', event));
document.addEventListener('pointermove', updateActiveTrimHandle);
document.addEventListener('pointermove', updateTimelineScrub);
document.addEventListener('pointerup', stopTrimHandleDrag);
document.addEventListener('pointerup', stopTimelineScrub);
videoPlayer.addEventListener('play', updatePlayPauseButton);
videoPlayer.addEventListener('play', startPlayheadLoop);
videoPlayer.addEventListener('pause', updatePlayPauseButton);
videoPlayer.addEventListener('pause', stopPlayheadLoop);
videoPlayer.addEventListener('ended', updatePlayPauseButton);
videoPlayer.addEventListener('ended', stopPlayheadLoop);
// Update time inputs when video time changes
videoPlayer.addEventListener('timeupdate', () => {
    if (!isTrimHandlePreviewing && !isScrubbingTimeline && videoPlayer.currentTime < startTime - 0.05) {
        videoPlayer.currentTime = startTime;
    }

    if (videoPlayer.paused) {
        updatePlayheadMarker();
    }
});

videoPlayer.addEventListener('seeked', () => {
    if ((isScrubbingTimeline || isTrimHandlePreviewing) && Number.isFinite(scrubPreviewTime)) {
        if (Math.abs(videoPlayer.currentTime - scrubPreviewTime) > 0.05) {
            applyVideoSeek(scrubPreviewTime);
        } else {
            updatePlayheadMarker(scrubPreviewTime);
        }

        return;
    }

    updatePlayheadMarker();
});

// Initialize
loadSettings();
loadAudioTrackSelections();
setupDragAndDrop();
restoreLastFolder();
console.log('Video Trimmer Pro loaded');