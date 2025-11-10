const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { authenticateToken, requireClient } = require('../middleware/auth');

// All routes require authentication and client role
router.use(authenticateToken);
router.use(requireClient);

// Notification management for clients
router.get('/', notificationController.getClientNotifications);
router.get('/unread-count', notificationController.getClientUnreadCount);
router.put('/:notificationId/read', notificationController.markClientNotificationAsRead);
router.put('/mark-all-read', notificationController.markAllClientNotificationsAsRead);
router.delete('/:notificationId', notificationController.deleteClientNotification);

module.exports = router;
























